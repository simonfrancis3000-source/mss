import test from 'node:test';
import assert from 'node:assert/strict';
import { createCognitiveRuntime } from '../server/cognitive-runtime.js';
import { createCognitiveProvider } from '../server/cognitive-provider.js';
import { checkRuntimeReply, validateTurnProposal, resolveRuntimeContext, reduceRuntimeState, cleanRuntimeState, RuntimeError } from '../server/cognitive-core.js';

const auth = { user: { id: 'owner-a' }, trainingRevision: '0' };
const objectives = [{ id: 'products', title: 'Cleaning products', subject: 'Your approved cleaning products' }];
const answer = (reply = 'I will follow that preference. When should I stop and ask you?') => ({ reply, reminderOffer: null, objectiveId: 'products' });
function fixture({ generate = async () => answer(), contextAvailable = true, language = 'en' } = {}) {
  const states = new Map(), ledger = new Map(), locks = new Map(), effects = [];
  let failCommit = false, loseCommitResponse = false, calls = 0;
  const key = (a, scope) => a.user.id + ':' + a.trainingRevision + ':' + scope;
  const store = {
    async claim(a, input) {
      const owner = key(a, input.scope), id = owner + ':' + input.key;
      const old = ledger.get(id);
      if (old && old.fingerprint !== input.fingerprint) throw new RuntimeError('runtime_turn_conflict', 409);
      if (old?.result) return { status: 'completed', result: structuredClone(old.result) };
      if (locks.has(owner)) throw new RuntimeError('runtime_busy', 409);
      locks.set(owner, input.key);
      ledger.set(id, { fingerprint: input.fingerprint });
      return { status: 'claimed', lease: 'lease', state: structuredClone(states.get(owner) || {}) };
    },
    async commit(a, input) {
      if (failCommit) throw new RuntimeError('runtime_storage_unavailable');
      const owner = key(a, input.scope);
      if (locks.get(owner) !== input.key) throw new RuntimeError('runtime_stale_lease', 409);
      if (input.action) effects.push({ owner: a.user.id, ...input.action });
      states.set(owner, structuredClone(input.state));
      ledger.get(owner + ':' + input.key).result = structuredClone(input.result);
      locks.delete(owner);
      if (loseCommitResponse) throw new RuntimeError('runtime_storage_unavailable');
      return { status: 'completed', result: input.result };
    },
    async release(a, input) { locks.delete(key(a, input.scope)); },
    async reminders(a) { return effects.filter(x => x.owner === a.user.id).map((x, i) => ({ id: String(i), title: x.title, completed: false })); }
  };
  const runtime = createCognitiveRuntime({ store, contextStore: { async loadContext() { return { available: contextAvailable, rules: [], appliances: [] }; } }, generate: async input => { calls++; return generate(input); } });
  let next = 0;
  const turn = (content, id, a = auth, scope = 'room:kitchen') => runtime.turn({ auth: a, scope, objectives, profile: { ownerName: 'Simon', preferredLanguage: language }, body: { clientTurnId: id || 'turn-' + ++next, messages: [{ role: 'user', content }] } });
  return { turn, states, effects, get calls() { return calls; }, fail(value = true) { failCommit = value; }, lose(value = true) { loseCommitResponse = value; } };
}

test('accepted server-owned reminder executes once and refresh/retry replays its durable result', async () => {
  const f = fixture({ generate: async () => ({ reply: 'Would you like me to add a reminder to check the hob model?', reminderOffer: { title: 'Find the hob model' }, objectiveId: 'products' }) });
  await f.turn('Let us discuss the hob.');
  const saved = await f.turn('Yes please.', 'accepted');
  assert.match(saved.reply, /Added to your reminders: Find the hob model/);
  assert.equal(f.effects.length, 1);
  const replay = await f.turn('Yes please.', 'accepted');
  assert.equal(replay.reply, saved.reply);
  assert.equal(replay.runtime.replayed, true);
  assert.equal(f.effects.length, 1);
  assert.equal(f.calls, 1);
});

test('failed transaction retains the pending offer and never returns successful-action wording', async () => {
  const f = fixture({ generate: async () => ({ reply: 'Would you like a reminder?', reminderOffer: { title: 'Check hob model' }, objectiveId: null }) });
  await f.turn('I cannot find the model.');
  f.fail();
  await assert.rejects(f.turn('Yes', 'accept'), /runtime_storage_unavailable/);
  assert.equal(f.effects.length, 0);
  assert.equal([...f.states.values()][0].pendingOffer.title, 'Check hob model');
  f.fail(false);
  assert.match((await f.turn('Yes', 'accept')).reply, /Added to your reminders/);
  assert.equal(f.effects.length, 1);
});

test('lost commit response recovers the result without repeating the effect', async () => {
  const f = fixture(); f.lose();
  await assert.rejects(f.turn('Add finding the hob model to my reminders', 'lost'));
  assert.equal(f.effects.length, 1);
  f.lose(false);
  const replay = await f.turn('Add finding the hob model to my reminders', 'lost');
  assert.equal(replay.runtime.replayed, true);
  assert.equal(f.effects.length, 1);
});

test('canonical unanswered question survives pause, new request transcript and a channel change', async () => {
  const f = fixture({ generate: async () => answer('We were discussing the cleaning products. Where do you keep them?') });
  await f.turn('Use only the approved products.');
  await f.turn('Pause');
  const resumed = await f.turn('Continue');
  assert.match(resumed.reply, /Welcome back, Simon/);
  assert.match(resumed.reply, /cleaning products/);
  assert.match(resumed.reply, /Where do you keep them/);
  assert.equal(f.calls, 1);
});

test('cancellation and a subject change cannot become consent', async () => {
  const f = fixture({ generate: async () => ({ reply: 'Would you like a reminder?', reminderOffer: { title: 'Check the hob model' }, objectiveId: null }) });
  await f.turn('The model is unavailable.');
  await f.turn('No thanks');
  assert.equal(f.effects.length, 0);
  const state = [...f.states.values()][0];
  assert.equal(state.pendingOffer, null);
  assert.equal(resolveRuntimeContext('Yes and then delete everything', { pendingOffer: { title: 'Check model' } }).command, null);
});

test('isolation applies to user, scenario and revision; a reused ID cannot change the answer', async () => {
  const f = fixture();
  await f.turn('Add finding the hob model to my reminders', 'same');
  await assert.rejects(f.turn('Add a different item to my reminders', 'same'), /runtime_turn_conflict/);
  await f.turn('Add finding the hob model to my reminders', 'same', { user: { id: 'owner-b' }, trainingRevision: '0' });
  await f.turn('Add finding the hob model to my reminders', 'same', auth, 'room:bedroom');
  await f.turn('Add finding the hob model to my reminders', 'same', { ...auth, trainingRevision: '1' });
  assert.equal(f.effects.length, 4);
});

test('concurrent turns do not run two model requests against the same state', async () => {
  let unblock;
  const wait = new Promise(resolve => { unblock = resolve; });
  const f = fixture({ generate: async () => { await wait; return answer(); } });
  const first = f.turn('Use a soft cloth.', 'one');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.turn('Use another cloth.', 'two'), /runtime_busy/);
  unblock(); await first;
  assert.equal(f.calls, 1);
});

test('quality engine blocks false success claims, repeated settled questions and acknowledgement dead ends', () => {
  const state = { dispositions: [{ question: 'Which cloth?', status: 'response_received' }], lastQuestion: null };
  assert.equal(checkRuntimeReply(answer('I have added a reminder. Which product?'), { state, active: true }), 'unverified_action_claim');
  assert.equal(checkRuntimeReply(answer('Your reminder has been saved. Which product?'), { state, active: true }), 'unverified_action_claim');
  assert.equal(checkRuntimeReply(answer('Got it.'), { state, active: true }), 'missing_continuation');
  assert.equal(checkRuntimeReply(answer('Which cloth?'), { state, active: true }), 'settled_question');
  assert.equal(checkRuntimeReply(answer('When should I stop?'), { state, active: false }), 'unexpected_question');
});

test('invalid JSON, truncated responses and quality failures have a bounded repair and no actions', async () => {
  let count = 0;
  const f = fixture({ generate: async () => { count++; if (count === 1) throw new RuntimeError('incomplete_model_proposal', 502); return answer(); } });
  await f.turn('Use a soft cloth.'); assert.equal(f.calls, 2);
  const bad = fixture({ generate: async () => answer('Got it.') });
  await assert.rejects(bad.turn('Use a soft cloth.'), /runtime_quality_check_failed/);
  assert.equal(bad.calls, 2); assert.equal(bad.effects.length, 0);
});

test('missing long-term memory fails closed instead of assuming permission', async () => {
  const f = fixture({ contextAvailable: false });
  await assert.rejects(f.turn('Use whatever product you like.'), /runtime_memory_unavailable/);
  assert.equal(f.calls, 0);
});

test('a question response is not a confirmed preference or a completed objective', () => {
  const state = cleanRuntimeState({ lastQuestion: 'Which mode?', objectiveId: 'dishwasher' });
  const next = reduceRuntimeState(state, { latestUser: 'Eco except when I am in a hurry.', reply: 'When would you need it sooner?', intent: 'conditional', active: true, turnKey: 'a' });
  assert.equal(next.dispositions[0].status, 'response_received');
  assert.equal(next.objectiveId, 'dishwasher');
  assert.match(next.messages[0].content, /except/);
  assert.equal(next.completed, undefined);
});

test('an unrelated rule does not settle an unanswered decision; a grounded answer does', () => {
  const initial=cleanRuntimeState({lastQuestion:'Where should damaged books wait?',lastDecisionKey:'books.damaged_location',objectiveId:'books'});
  const unrelated=reduceRuntimeState(initial,{latestUser:'If unsure, ask me instead of guessing.',reply:'What should I learn next?',intent:'answer',turnKey:'one',active:true});
  assert.equal(unrelated.dispositions[0].answered,false);
  assert.equal(checkRuntimeReply({...answer('Should damaged books wait on the desk or stay on the shelf?'),decisionKey:'books.damaged_location'},{state:unrelated,active:true}),null);
  const answered=reduceRuntimeState(initial,{latestUser:'Leave damaged books on the desk.',reply:'What should I learn next?',intent:'answer',turnKey:'two',previousAnswer:{answered:true,sourceQuote:'on the desk'},active:true});
  assert.equal(answered.dispositions[0].answered,true);
  assert.equal(checkRuntimeReply({...answer('Should they wait on the shelf?'),decisionKey:'books.damaged_location'},{state:answered,active:true}),'settled_decision');
  const forged=reduceRuntimeState(initial,{latestUser:'If unsure, ask me.',reply:'What should I learn next?',intent:'answer',turnKey:'three',previousAnswer:{answered:true,sourceQuote:'on the desk'},active:true});
  assert.equal(forged.dispositions[0].answered,false);
});

test('provider validates JSON locally, reports usage, and rejects fabricated tool actions', async () => {
  let payload, usage = 0;
  const provider = createCognitiveProvider({ key: 'fixture', model: 'fixture-model', onUsage: async () => { usage++; }, fetchImpl: async (url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ schema_version: 1, reply: 'When should I ask?', objective_id: 'products', actions: [] }) } }] });
  } });
  assert.equal((await provider({ context: {}, objectives })).reply, 'When should I ask?');
  assert.equal(payload.response_format.type, 'json_object'); assert.equal(payload.thinking.type, 'disabled'); assert.equal(usage, 1);
  assert.throws(() => validateTurnProposal({ schema_version: 1, reply: 'Done.', actions: [{ type: 'spend_money' }] }), /model_action_rejected/);
});

test('Spanish acceptance with accents, pause and resume preserve the offered action', async () => {
  const f = fixture({ language: 'es', generate: async () => ({ reply: '¿Quieres que añada un recordatorio para buscar el modelo?', reminderOffer: { title: 'Buscar el modelo de la placa' }, objectiveId: 'products' }) });
  await f.turn('No encuentro el modelo.');
  await f.turn('Pausa');
  assert.match((await f.turn('Continuar')).reply, /Nos quedamos aquí/);
  const result = await f.turn('Sí, por favor.', 'aceptar');
  assert.match(result.reply, /He añadido a tus recordatorios/);
  assert.equal(f.effects.length, 1); assert.equal(f.calls, 1);
  assert.equal((await f.turn('Sí, por favor.', 'aceptar')).runtime.replayed, true);
});

test('Spanish cancellation and explanation do not authorize an action', () => {
  const state = { pendingOffer: { id: 'one', title: 'Buscar el modelo' } };
  assert.equal(resolveRuntimeContext('No, gracias.', state).intent, 'cancel_offer');
  assert.equal(resolveRuntimeContext('¿Por qué preguntas eso?', state).command, null);
});

// 100 synthetic multi-turn trajectories: 5 concrete missing details, 5
// acceptance forms, 4 lifecycle paths. Held-out cases are labelled separately
// in the report; these are deterministic integration evaluations, not evidence
// of live DeepSeek semantic quality or Phonic listening quality.
const details = ['hob exact model', 'dishwasher brand', 'washing machine model', 'vacuum filter type', 'coffee machine manual'];
const accepts = ['Yes', 'Yes please', 'Please do', 'Go ahead', 'And as a reminder'];
for (const [i, detail] of details.entries()) for (const [j, acceptance] of accepts.entries()) for (const path of ['retry', 'pause', 'failure', 'cancel']) {
  const split = j === 4 ? 'held-out' : 'development';
  test(`trajectory/${split}/${i}/${j}/${path}: ${detail}`, async () => {
    const title = 'Find the ' + detail;
    const f = fixture({ generate: async () => ({ reply: 'Would you like a reminder to find the ' + detail + '?', reminderOffer: { title }, objectiveId: 'products' }) });
    await f.turn('I cannot find that information.');
    if (path === 'cancel') { await f.turn('No thanks'); assert.equal(f.effects.length, 0); return; }
    if (path === 'pause') { await f.turn('Pause'); const resumed = await f.turn('Continue'); assert.match(resumed.reply, /reminder/); }
    if (path === 'failure') { f.fail(); await assert.rejects(f.turn(acceptance, 'accept')); assert.equal(f.effects.length, 0); f.fail(false); }
    const result = await f.turn(acceptance, 'accept');
    assert.match(result.reply, /Added to your reminders/);
    assert.equal(f.effects.length, 1); assert.equal(f.effects[0].title, title);
    const again = await f.turn(acceptance, 'accept');
    assert.equal(again.runtime.replayed, true); assert.equal(f.effects.length, 1);
  });
}


test('provider diagnostics distinguish setup failures without exposing upstream response content', async () => {
  for (const [status,code] of [[401,'runtime_model_auth_rejected'],[402,'runtime_model_balance_insufficient'],[404,'runtime_model_not_found'],[422,'runtime_model_request_invalid'],[429,'runtime_model_rate_limited'],[503,'runtime_model_unavailable']]) {
    const provider=createCognitiveProvider({key:'fixture-secret',model:'fixture-model',fetchImpl:async()=>Response.json({error:{message:'fixture-secret account-private-details'}},{status})});
    await assert.rejects(provider({context:{},objectives}),error=>error.code===code && error.providerStatus===status && !String(error).includes('fixture-secret') && !String(error).includes('account-private-details'));
  }
});


test('a quoted example question is repaired before the canonical reply is committed', async () => {
  const f=fixture({generate:async({correction})=>answer(correction ? 'I will wait for your guidance. When should I ask the dog owner for permission?' : 'Should I say "May I pet the dog?", or wait for your guidance?')});
  const result=await f.turn('If a dog approaches, wait for my guidance.');
  assert.equal(f.calls,2);
  assert.equal(result.reply,'I will wait for your guidance. When should I ask the dog owner for permission?');
  assert.equal([...f.states.values()][0].messages.at(-1).content,result.reply);
});

test('a repeated multiple-question failure exhausts one repair and commits no canonical reply', async () => {
  const f=fixture({generate:async()=>answer('Should I ask permission? Or wait for your guidance?')});
  await assert.rejects(f.turn('Wait for my guidance.'),error=>error.code==='runtime_quality_check_failed'&&error.attempts.length===2);
  assert.equal(f.calls,2);assert.equal(f.states.size,0);assert.equal(f.effects.length,0);
});


test('an active explanation answers first and leads with one useful next question',async()=>{
 const f=fixture({generate:async({context})=>{assert.equal(context.intent,'explain');return answer('Your current preference is folded towels, with approval before changes. What should I do if a towel is damaged?');}});
 const result=await f.turn('Explain my current towel preference and its exception.');
 assert.match(result.reply,/folded towels/);assert.match(result.reply,/What should I do if a towel is damaged\?/);assert.equal(f.calls,1);
 assert.equal(resolveRuntimeContext('Explícame mi preferencia actual.',cleanRuntimeState()).intent,'explain');
});
