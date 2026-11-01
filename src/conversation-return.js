export const RETURN_GREETING_GAP_MS = 12 * 60 * 60 * 1000;
export function shouldWelcomeBack(messages = [], now = Date.now()) {
  const last = [...messages].reverse().find(item => item?.role === 'user' && Number.isFinite(Date.parse(item.timestamp || '')));
  if (!last) return false;
  const elapsed = now - Date.parse(last.timestamp);
  return elapsed >= RETURN_GREETING_GAP_MS;
}
export function welcomeBackReply(reply, ownerName, language = 'en') {
  const name = String(ownerName || '').trim().split(/\s+/)[0];
  if (language !== 'en' || !name) return reply;
  const greeting = 'Welcome back, ' + name + '.';
  return /^welcome back\b/i.test(reply.trim()) ? reply : greeting + '\n\n' + reply;
}
export function spokenSentenceBreaks(text) {
  return String(text || '').replace(/([.!?。！？])[\t ]+(?=\S)/g, '$1\n\n');
}
