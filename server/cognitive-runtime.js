import { generateCheckedCognitiveTurn } from './cognitive-provider.js';
import { cleanRuntimeState, turnIdentity, resolveRuntimeContext, relevantMemory, nextRuntimeObjective, checkRuntimeReply, reduceRuntimeState, RuntimeError, RUNTIME_VERSION, normalized } from './cognitive-core.js';
import { matchReminder, validReminderTitle } from '../src/reminders.js';
import { conversationCheckpoint } from '../src/conversation-resume.js';
import { applianceIntakeRequirement } from '../src/appliance-persona.js';
import { applianceReminderTurn } from '../src/appliance-reminders.js';
import { validateMemoryProposals } from './cognitive-memory.js';
import { buildDecisionPlan } from './cognitive-planner.js';
import { applianceMemoryProposal, verifiedFeatureQuotes } from './cognitive-appliance.js';

function followup(objectives, state, language) {
  // Deterministic recovery is deliberately limited to the evaluated languages.
  // For other languages the provider composes the continuation before commit.
  const es = language === 'es';
  if(state.lastQuestion&&!state.pendingOffer&&!state.dispositions.some(d=>d.answered!==false&&normalized(d.question)===normalized(state.lastQuestion)))return state.lastQuestion;
  const ordered = [...objectives.filter(o => o.id === state.objectiveId), ...objectives.filter(o => o.id !== state.objectiveId)];
  for (const area of ordered) {
    const subject = String(area.title || '').toLowerCase();
    const questions = es
      ? ['Para esta tarea, ¿qué te gustaría que hiciera primero?', 'Para esta tarea, ¿qué situación cambiaría tu rutina habitual?', 'Para esta tarea, ¿cuándo debería parar y preguntarte?']
      : ['For ' + subject + ', what would you like me to do first?', 'For ' + subject + ', what situation would change your usual routine?', 'For ' + subject + ', when should I stop and ask you?'];
    const question = questions.find(q => normalized(q) !== normalized(state.lastQuestion) && !state.dispositions.some(d => normalized(d.question) === normalized(q)));
    if (question) return question;
  }
  return es ? 'Puedes abrir Journey para revisar lo aprendido o elegir un detalle que quieras cambiar.' : 'You can open Journey to review the saved learning or choose a detail you want to change.';
}

async function reminderAction(store, auth, command, language) {
  const es = language === 'es';
  if (command.action === 'help') return { reply: es ? 'Dime el título concreto del recordatorio que quieres añadir, cambiar o eliminar.' : 'Tell me the specific reminder you want to add, change or remove.' };
  if (command.action === 'add') {
    const title = validReminderTitle(command.title);
    if (!title) return { reply: es ? '¿Qué quieres que diga el recordatorio?' : 'What would you like the reminder to say?' };
    return { action: { type: 'add', title }, reply: es ? 'He añadido a tus recordatorios: ' + title + '.' : 'Added to your reminders: ' + title + '.' };
  }
  const rows = await store.reminders(auth);
  if (command.action === 'list') {
    const open = rows.filter(r => !r.completed);
    return { reply: open.length ? (es ? 'Tus recordatorios pendientes: ' : 'Your open reminders: ') + open.slice(0, 15).map(r => r.title).join('; ') + '.' : es ? 'No tienes recordatorios pendientes.' : 'You have no open reminders.' };
  }
  const match = matchReminder(rows, command.query);
  if (match.status !== 'matched') return { reply: match.status === 'ambiguous' ? es ? '¿Cuál es el título exacto del recordatorio?' : 'What is the exact title of the reminder?' : es ? 'No encuentro ese recordatorio. Puedes pedirme la lista.' : 'I could not find that reminder. You can ask me to list your reminders.' };
  const title = command.action === 'edit' ? validReminderTitle(command.title) : match.item.title;
  if (!title) throw new RuntimeError('invalid_reminder_title', 400);
  const prefixes = es ? { edit: 'Recordatorio actualizado: ', delete: 'Recordatorio eliminado: ', complete: 'Recordatorio completado: ' } : { edit: 'Updated your reminder: ', delete: 'Removed from your reminders: ', complete: 'Marked complete: ' };
  if (!prefixes[command.action]) throw new RuntimeError('unsupported_action', 400);
  return { action: { type: command.action, id: match.item.id, title }, reply: prefixes[command.action] + title + '.' };
}

export function createCognitiveRuntime({ store, generate, contextStore, resolveAppliance = async () => null, onCommitted = () => {}, onObservation = async () => {} }) {
  return {
    async turn({ auth, body, scope, objectives, profile, active = true }) {
      const latestUser = body.messages?.at(-1)?.content;
      if (typeof latestUser !== 'string' || !latestUser.trim() || latestUser.length > 3000) throw new RuntimeError('invalid_user_turn', 400);
      const identity = turnIdentity(body, scope, latestUser);
      const started = performance.now();
      const timings = {};
      const measured = async (phase, task) => { const start=performance.now();try{return await task();}finally{timings[phase]=(timings[phase] || 0)+Math.round(performance.now()-start);} };
      const claimed = await measured('claimMs',()=>store.claim(auth, { ...identity, scope }));
      if (claimed?.status === 'completed' && claimed.result?.expired) throw new RuntimeError('runtime_turn_expired',409);
      if (claimed?.status === 'completed' && claimed.result) return { ...claimed.result, runtime: { ...claimed.result.runtime, replayed: true } };
      if (claimed?.status !== 'claimed' || !claimed.lease) throw new RuntimeError('runtime_storage_unavailable');
      const handle = { ...identity, scope, lease: claimed.lease };
      try {
        const state = cleanRuntimeState(claimed.state);
        if (!state.lastQuestion && state.messages.length) state.lastQuestion = conversationCheckpoint(state.messages, scope)?.question || null;
        const resolved = resolveRuntimeContext(latestUser, state);
        const language = profile.preferredLanguage || 'en';
        const es = language === 'es';
        let reply, offer = null, action = null, proposal = null, contextLoaded = false, modelCalls = 0;
        let memoryProposals = [], appliance = null, intake = null;
        const requestMessages = [...state.messages, { role: 'user', content: latestUser }];
        const paused = resolved.intent === 'pause' || body.voiceBreakDue === true;
        let training = active && !paused;
        if (['en', 'es'].includes(language) && paused) {
          reply = es ? 'Hacemos una pausa. Podemos continuar desde este punto cuando quieras.' : 'We can pause here and pick up from this point when you are ready.';
        } else if (['en', 'es'].includes(language) && resolved.intent === 'resume' && state.lastQuestion) {
          // The canonical previous reply retains pronoun context. No client
          // checkpoint can overwrite this server-committed question.
          const prior = [...state.messages].reverse().find(m => m.role === 'assistant' && m.content.includes(state.lastQuestion));
          const context = prior?.content || state.lastQuestion;
          const name = String(profile.ownerName || '').trim().split(/\s+/)[0].slice(0, 60);
          reply = (es ? 'Bienvenido de nuevo' : 'Welcome back') + (name ? ', ' + name : '') + (es ? '. Nos quedamos aquí:\n\n' : '. We left off here:\n\n') + context;
          offer = state.pendingOffer;
        } else if (['en', 'es'].includes(language) && resolved.intent === 'cancel_offer') {
          reply = (es ? 'No añadiré ese recordatorio.' : 'I will not add that reminder.') + (training ? ' ' + followup(objectives, state, language) : '');
        } else if (resolved.command && ['en', 'es'].includes(language)) {
          const result = await reminderAction(store, auth, resolved.command, language);
          action = result.action || null;
          reply = result.reply;
          if (training && (action || resolved.command.action === 'list')) reply += ' ' + followup(objectives, state, language);
        } else {
          const [saved,review] = await measured('contextMs',()=>Promise.all([
            contextStore.loadContext(auth, { scopeKey: scope, query: latestUser + ' ' + (state.lastQuestion || '') }),
            store.review ? store.review(auth,scope) : Promise.resolve({})
          ]));
          contextLoaded = saved.available === true;
          // Missing memory is not equivalent to no preferences. Keep the turn
          // retryable rather than reasoning around unknown boundaries.
          if (!contextLoaded) throw new RuntimeError('runtime_memory_unavailable');
          // Receipt alone does not establish that the owner answered a question.
          const qualityState={...state,dispositions:[...state.dispositions,...(saved.decisions || []).filter(d=>['response_received','deferred'].includes(d.status)&&d.question).map(d=>({question:d.question,status:d.status,answered:d.status==='deferred'||d.source_refs?.some(r=>r?.answered===true)===true,decisionKey:d.decision_key?.startsWith('cogd:')?d.decision_key.slice(5):null}))]};
          if (review.completionConfirmed) training = false;
          const planned = buildDecisionPlan({objectives,state,context:{...saved,relations:review.relations || []},review});
          if (review.activeAreaId && objectives.some(o=>o.id===review.activeAreaId)) state.objectiveId=review.activeAreaId;
          intake = applianceIntakeRequirement(requestMessages, saved.appliances || [], []);
          const deferred = intake && state.dispositions.some(d => ['deferred', 'not_applicable'].includes(d.status) && d.question.toLowerCase().includes(intake.type.toLowerCase()));
          if (deferred || ['deferred', 'not_applicable'].includes(resolved.intent)) intake = null;
          const missing = language === 'en' ? applianceReminderTurn(requestMessages) : null;
          if (missing?.reply) {
            const title = missing.reply.match(/“([^”]+)”/)?.[1];
            if (validReminderTitle(title)) { reply = missing.reply; offer = { title }; }
          }
          if (!reply) {
            const context = { version: RUNTIME_VERSION, scope, language, profile: { ownerName: profile.ownerName, companionName: profile.companionName || profile.robotName },
              activeTraining: training, intent: resolved.intent, state:{...state,messages:state.messages.slice(-10).map(m=>({...m,content:m.content.slice(0,650)})),dispositions:qualityState.dispositions.slice(-40)}, latestUser, memory: relevantMemory(saved), plan: planned, objectives, intake,
              boundaries: 'Do not change scenario or mark completion. No live robot is connected. Appliance identities do not establish any feature.',
              currentApplianceIdentities: (saved.appliances || []).slice(0, 10).map(a => ({ type: a.type, brand: a.brand, model: a.model })) };
            const checked = await generateCheckedCognitiveTurn({
              generate: input => { modelCalls++; return measured('modelMs',()=>generate({...input,auth})); },
              context, objectives,
              validateProposal: candidate => validateMemoryProposals(candidate.memoryProposals || [],{latestUser,knownRules:[...(saved.rules || []),...(saved.generalRules || [])],existingRelations:review.relations || [],objectives,turnKey:identity.key,scope}),
              quality: { state:qualityState, active:training && resolved.intent !== 'service_help', intake, language }
            });
            proposal = checked.proposal;
            // Exact-model turns may need one additional composition after the
            // official manual has been verified. Ordinary turns do not pay it.
            if (proposal.applianceIdentity) {
              const resolvedAppliance = await measured('manualMs',()=>resolveAppliance({identity:proposal.applianceIdentity,messages:requestMessages,saved:saved.appliances || [],auth}));
              if (resolvedAppliance) {
                appliance = resolvedAppliance.record;
                if (resolvedAppliance.evidence) {
                  modelCalls++;
                  proposal = await measured('modelMs',()=>generate({context:{...context,intake:null,verifiedManual:resolvedAppliance.evidence},objectives,auth}));
                  const invalid = checkRuntimeReply(proposal,{state:qualityState,active:training,intake:null,language,latestUser,intent:resolved.intent});
                  if (invalid) throw new RuntimeError('runtime_quality_check_failed',502);
                  const quotes=verifiedFeatureQuotes(proposal.featureQuotes,resolvedAppliance.evidence);
                  const featureBudget=Math.max(0,3000-proposal.reply.length-70);
                  while(quotes.length && quotes.join('; ').length>featureBudget)quotes.pop();
                  // Feature passages are quoted verbatim from verified content,
                  // not treated as model-established appliance capabilities.
                  if (quotes.length) proposal.reply=(es?'El manual destaca: ':'The manual highlights: ')+quotes.map(q=>'“'+q.replace(/[?？؟]/gu,'')+'”').join('; ')+'. '+proposal.reply;
                }
              }
            }
            reply = proposal.reply;
            offer = proposal.reminderOffer;
            memoryProposals = validateMemoryProposals(proposal.memoryProposals || [],{latestUser,knownRules:[...(saved.rules || []),...(saved.generalRules || [])],existingRelations:review.relations || [],objectives,turnKey:identity.key,scope});
            if (appliance) {const memory=applianceMemoryProposal(appliance,latestUser);if(memory)memoryProposals=[...memoryProposals.slice(0,7),memory];}
          }
        }
        const preserveOpenQuestion=Boolean(resolved.command&&training&&!state.pendingOffer&&state.lastQuestion&&reply.includes(state.lastQuestion));
        const next = reduceRuntimeState(state, { latestUser, reply, intent: paused ? 'pause' : resolved.intent, offer, turnKey: identity.key, objectiveId: proposal?.objectiveId, decisionKey:proposal?.decisionKey || (preserveOpenQuestion?state.lastDecisionKey:null), previousAnswer:proposal?.previousAnswer, preserveOpenQuestion, active: training });
        const sourceDate=Date.parse(body.sourceMessageTimestamp || '');
        const sourceTimestamp=Number.isFinite(sourceDate)&&sourceDate>=Date.UTC(2010,0,1)&&sourceDate<=Date.now()+300000?new Date(sourceDate).toISOString():new Date().toISOString();
        const result = { reply, provider: 'deepseek', usedFallback: true,
          ...(resolved.intent === 'resume' ? { resumed: true } : {}),
          amiaPersistence: { status: 'saved', context_loaded: contextLoaded, memory_queued:memoryProposals.length>0, appliance_saved:false },
          ...(appliance ? {appliance} : {}),
          runtime: { version: RUNTIME_VERSION, turnId: identity.key, replayed: false, action: action?.type || null, modelCalls } };
        // The reminder operation, canonical response and state transition are
        // one database transaction. A failed transaction cannot emit success.
        const committed = await measured('commitMs',()=>store.commit(auth, { ...handle, state: next, result, action,enrichment:{memories:memoryProposals,sourceTimestamp} }));
        if (committed?.status !== 'completed' || !committed.result) throw new RuntimeError('runtime_storage_unavailable');
        try { onCommitted(); } catch {}
        // Observations are optional telemetry, explicitly not passed tests.
        // They cannot change the already-committed action or user response.
        void Promise.resolve().then(() => onObservation({ auth, scope, latestUser, reply, source: body.sourceMessageTimestamp })).catch(() => {});
        return { ...committed.result, runtime: { ...committed.result.runtime, durationMs: Math.round(performance.now() - started), timings } };
      } catch (error) {
        // This is safe even if a timed-out commit actually succeeded: release
        // does not change a completed ledger row. Retry returns its result.
        await store.release(auth, handle).catch(() => {});
        throw error instanceof RuntimeError ? error : new RuntimeError('runtime_turn_unavailable');
      }
    }
  };
}
