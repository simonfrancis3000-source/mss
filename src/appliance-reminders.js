import { DEVICE_NAMES } from './appliance-persona.js';

const unknown = /\b(?:don['’]?t|do not|can['’]?t|cannot|couldn['’]?t|could not)\s+(?:know|have|find|see|read|remember|access)|\b(?:not sure|no idea|unknown|unavailable|not (?:available|with me)|haven['’]?t got)\b/i;
const fields = /\b(serial(?: number)?|model(?: number| code)?|make|brand|manufacturer|product number|pnc|e-?nr|manual|instructions|dimensions|capacity|wattage|power rating)\b/ig;
const offerPattern = /Would you like me to add “([^”\n]{3,200})” to your to-do reminders\?/;
export function applianceReminderTurn(messages = []) {
  const latest = messages.at(-1);
  if (latest?.role !== 'user') return null;
  const text = String(latest.content || '').trim();
  const previous = messages.at(-2)?.role === 'assistant' ? String(messages.at(-2).content || '') : '';
  // AMÏA can naturally offer a reminder without using the exact quoted
  // template. The app, not the language model, must persist an accepted offer.
  const quotedOffer = previous.match(offerPattern);
  const naturalOffer = /\b(?:would you like|shall i|should i|do you want|want me to|can i|could i)\b[\s\S]{0,220}\b(?:add|create|put|save|set)\b[\s\S]{0,150}\b(?:reminder|to[ -]?do)\b/i.test(previous);
  if (quotedOffer || naturalOffer) {
    const confirmation = text.replace(/[.!?]+$/g, '').trim();
    const accepted = /^(?:yes(?:\s*,?\s*(?:please|go ahead|add (?:it|that)|do (?:that|it)|make (?:it|that) a reminder))?|yeah|yep|yup|sure|okay|ok|please do|do that|add it|please add it|(?:and\s+)?as a reminder|(?:yes,?\s*)?add (?:it|that)(?: to (?:my|the) reminders?)?|(?:save|put) (?:it|that) (?:as|in|on) (?:a|my|the) reminder(?:s| list)?)$/i.test(confirmation);
    if (/^(?:no(?: thanks| thank you)?|not now|skip(?: it)?|cancel|never mind)[.! ]*$/i.test(text)) return {reply:"Okay, I won't add a reminder. We can leave that detail open."};
    if (!accepted) return null; // Do not treat a changed subject as consent.
    const history = [previous, ...messages.slice(-12, -2).reverse().map(item => String(item.content || ''))];
    const device = history.map(value => value.match(DEVICE_NAMES)?.[0]).find(Boolean);
    const field = [...previous.matchAll(fields)].at(-1)?.[1] ||
      history.slice(1).map(value => [...value.matchAll(fields)].at(-1)?.[1]).find(Boolean);
    const title = quotedOffer?.[1] || (device && field ? 'Find the ' + device.toLowerCase() + ' ' + field.toLowerCase() : '');
    return title ? {command:{action:'add',title}} : null;
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
