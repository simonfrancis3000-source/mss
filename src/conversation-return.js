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
export function addressByNameReply(reply, ownerName, recentMessages = []) {
  const name = String(ownerName || '').trim().split(/\s+/)[0];
  if (!name || String(reply).toLocaleLowerCase().includes(name.toLocaleLowerCase())) return reply;
  const recent = recentMessages.filter(item => item.role === 'assistant').slice(-4);
  if (recent.some(item => String(item.content || '').toLocaleLowerCase().includes(name.toLocaleLowerCase()))) return reply;
  const opening = /^(?:Understood|Got it|That|Yes|No|Let['’]s|We|You|Thanks|Good|Right|Okay)\b/.test(reply)
    ? reply.charAt(0).toLowerCase() + reply.slice(1) : reply;
  return name + ', ' + opening;
}
