import { DEVICE_NAMES } from './appliance-persona.js';

const unknown = /\b(?:don['’]?t|do not|can['’]?t|cannot|couldn['’]?t|could not)\s+(?:know|have|find|see|read|remember|access)|\b(?:not sure|no idea|unknown|unavailable|not (?:available|with me)|haven['’]?t got)\b/i;
const fields = /\b(serial(?: number)?|model(?: number| code)?|make|brand|manufacturer|product number|pnc|e-?nr|manual|instructions|dimensions|capacity|wattage|power rating)\b/ig;
const offerPattern = /Would you like me to add “([^”\n]{3,200})” to your to-do reminders\?/;
export function applianceReminderTurn(messages = []) {
  const latest = messages.at(-1);
  if (latest?.role !== 'user') return null;
  const text = String(latest.content || '').trim();
  const previous = messages.at(-2)?.role === 'assistant' ? String(messages.at(-2).content || '') : '';
  const offer = previous.match(offerPattern);
  if (offer) {
    if (/^(?:yes(?: please)?|yeah|yep|sure|okay|ok|please do|do that|add it|please add it|yes,? (?:add it|do that|please do))[.! ]*$/i.test(text)) return {command:{action:'add',title:offer[1]}};
    if (/^(?:no(?: thanks| thank you)?|not now|skip(?: it)?|cancel|never mind)[.! ]*$/i.test(text)) return {reply:"Okay, I won't add a reminder. We can leave that detail open."};
    return null; // A changed subject or an ambiguous answer is never consent.
  }
  if (!unknown.test(text) || /\b(?:password|pin|access code|security code|credentials)\b/i.test(text)) return null;
  if (/\b(?:skip|no reminders?|don't remind|do not remind)\b/i.test(text)) return null;
  const field = [...text.matchAll(fields)].at(-1)?.[1] || [...previous.matchAll(fields)].at(-1)?.[1];
  if (!field) return null;
  const recent = messages.slice(-8);
  const device = text.match(DEVICE_NAMES)?.[0] || previous.match(DEVICE_NAMES)?.[0] || [...recent].reverse().map(m=>String(m.content||'').match(DEVICE_NAMES)?.[0]).find(Boolean);
  if (!device) return null;
  // "I don't have an oven" is absence of ownership, not missing identity.
  if (new RegExp("(?:don't|do not|no longer) (?:have|own|use) (?:an? |the )?" + device + "[.! ]*$",'i').test(text)) return null;
  const title = 'Find the ' + device.toLowerCase() + ' ' + field.toLowerCase();
  if (recent.some(m=>m.role==='assistant' && String(m.content||'').includes('“'+title+'”'))) return null;
  const prefix = /^serial/i.test(field) ? 'A serial number is usually unnecessary for finding the manual; the make and exact model are normally enough. If you want to keep it for your own records, ' : 'We can leave that detail open for now. ';
  return {reply:prefix + 'Would you like me to add “' + title + '” to your to-do reminders?'};
}
