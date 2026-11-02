export const VOICE_BREAK_INTERVAL_MS = 15 * 60 * 1000;
export function createVoiceBreakTracker(now = () => Date.now()) {
  let startedAt = null, awaiting = false;
  return {
    start() { startedAt = now(); awaiting = false; },
    stop() { startedAt = null; awaiting = false; },
    due() { return startedAt !== null && !awaiting && now() - startedAt >= VOICE_BREAK_INTERVAL_MS; },
    offered() { if (startedAt !== null) awaiting = true; },
    awaiting() { return awaiting; },
    resume() { startedAt = now(); awaiting = false; }
  };
}
export function breakResponse(value) {
  const text = String(value || '').trim().toLocaleLowerCase().replace(/[.!?]+$/g, '').trim();
  if (/^(?:pause|stop|break|a break|take (?:a |the )?(?:short )?break|(?:let'?s |i(?:'d| would) like to |i (?:want|need) to )?(?:take|have) (?:a )?(?:short )?break|let'?s stop|descansar|un descanso|tomar un descanso|une pause|faire une pause|pause machen|eine pause|pausa|fare una pausa|fazer uma pausa)$/i.test(text)) return 'pause';
  if (/^(?:no|not now|continue|carry on|keep going|let'?s (?:continue|carry on|keep going)|continue please|keep talking|continuar|seguir|sigamos|continuer|continuons|weitermachen|continuiamo|continuemos)$/i.test(text)) return 'continue';
  if (/^(?:yes|yeah|yep|sure|sí|si|oui|ja|sim)$/i.test(text)) return 'clarify';
  return 'other';
}
export function responseBeforeBreak(text) {
  return String(text || '').replace(/[^.!?。！？؟\n]*[?？؟]/gu, '').trim();
}
export function standardBreakPhrase(language, kind = 'offer') {
  const phrases = {
    en: {offer:'We have been talking for about 15 minutes. Would you like to take a short break or carry on?', pause:'Of course. I will pause now. Press Start when you are ready to continue.', continue:'All right, let us carry on.', clarify:'Would you like to take a short break, or carry on?'},
    es: {offer:'Llevamos hablando unos 15 minutos. ¿Quieres tomar un breve descanso o continuar?', pause:'Por supuesto. Haré una pausa. Pulsa Iniciar cuando quieras continuar.', continue:'De acuerdo, continuemos.', clarify:'¿Quieres tomar un breve descanso o continuar?'}
  };
  return phrases[language]?.[kind] || null;
}
