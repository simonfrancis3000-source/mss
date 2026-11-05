/** Guidance shared by text and voice. Facts are grounded only in supplied context. */
export function buildApplianceConversationGuidance() {
  return `HOUSEHOLD DEVICES AND APPLIANCES
When an owner first mentions an appliance or device, such as a dishwasher, washing machine, dryer, vacuum, air fryer, microwave or coffee maker, respond naturally and explain briefly that its make and model help find the right instructions. Ask for the make if unknown. When the make is known but the exact model is not, ask for the model number, not the make again, and in the same turn give a concise likely label location and describe its appearance: it commonly contains letters and numbers, sometimes with a slash or suffix, but formats vary. For many washers, dryers and dishwashers the label may be on the door or door frame; for smaller devices it may be on the base, back or body. These are possibilities, not guarantees; the manufacturer may call it Model, Product Number, PNC or E-Nr. Accept the complete suffix. Ask one question at a time. Never confuse a model number with a serial number. Make and exact model normally suffice to identify a manual. Do not request a serial number unless a specific manufacturer lookup genuinely requires it and you explain why. Never request passwords, access codes or network credentials.
Never claim to see the device or ask someone to move a heavy or plugged-in appliance. Let the owner skip any request. If useful information is unavailable, offer to add a clearly named task to their to-do reminders before moving on. Wait for explicit consent. Never claim it was saved until the app confirms success. These are to-do reminders, not scheduled notifications. If they decline, skip or change topic, respect that and continue without repeating the request. Use only the identity they have explicitly stated or confirmed, keeping different appliances separate. Respect a correction or replacement. Do not repeatedly ask after a user declines or changes subject or if the identity is already recorded.
If no actual verified manual content has been supplied in the conversation context, say clearly when necessary that you cannot confirm model-specific features; never say you found, read or saved a manual, never invent a manual link, Wi-Fi, cycles, instructions, access or features. Generic suggestions must be framed as possibilities to check, not facts about the device. Never claim a manual link was saved unless the app confirms the save. If a verified manual excerpt is supplied, say you reviewed the available manual text, and briefly mention up to two useful features supported by that text, such as connectivity, programmes or controls, explaining their possible relevance to a future companion. Do not imply you read the entire document when only excerpts were supplied. Distinguish manufacturer information, user preferences and guesses; mention a feature only when it is supported by the matched model's excerpt. Do not claim a feature is safe or compatible with a robot without verified PEXI capability, integration and user permission. Never promise to perform or control a task now.
Use the owner’s aim, verified information and known preferences to consider a few plausible hidden dependencies, exceptions and consequences. Ask only the most relevant unanswered question that could change the outcome, such as whether an item is suitable for a specific cycle, what should happen with a partially full load, whether a device should run while someone is sleeping, or whether permission is needed to start it. Do not overwhelm the user or turn every message into an interview.`;
}

/** Only send a short answer for extraction when the immediately preceding question
 * explicitly requests an appliance brand or model; the extractor still validates context. */
export function isApplianceIdentityAnswer(answer, previousQuestion) {
  const text = String(answer || '').trim();
  if (!text || text.length > 120 || /^(?:i (?:do not|don't) know|not sure|skip|later|no|yes|unknown|no idea)[.! ]*$/i.test(text)) return false;
  return /\b(?:brand|manufacturer|make|model(?:\s+(?:number|code|name))?|e-?nr)\b/i.test(String(previousQuestion || '')) && /\?/.test(String(previousQuestion || ''));
}

export const DEVICE_NAMES = /\b(dishwasher|washing machine|washer|tumble dryer|dryer|robot vacuum|vacuum(?: cleaner)?|air fryer|microwave|coffee (?:maker|machine)|refrigerator|fridge|freezer|oven|cooker|stove|hob|cooktop|kettle|toaster|blender|food processor|mixer|pressure cooker|slow cooker|rice cooker|extractor(?: hood)?|range hood|air conditioner|air purifier|dehumidifier|humidifier|heater|boiler|thermostat|water heater|television|tv|speaker|lawn ?mower|iron|steamer|appliance|device)\b/i;
const IDENTITY_QUESTION = /\b(?:make|brand|manufacturer|model|product number|pnc|e-?nr)\b/i;
// Intake is driven by the current exchange and account records, never by a
// shared owner's appliance. A skipped or already answered request stays skipped.
export function applianceIntakeRequirement(messages = [], records = [], exchanges = []) {
  const latest = messages.at(-1)?.role === 'user' ? messages.at(-1).content || '' : '';
  const previous = messages.at(-2)?.role === 'assistant' ? messages.at(-2).content || '' : '';
  const earlierType = messages.slice(0,-1).reverse().filter(item=>item.role==='user').map(item=>String(item.content||'').match(DEVICE_NAMES)).find(Boolean);
  const identityReply=isApplianceIdentityAnswer(latest,previous);
  const confirmsOwnership=/^(?:yes|yeah|yep|sure|we do|i do)\b/i.test(latest.trim())&&/\b(?:own|have|use)\b/i.test(previous);
  const type = (latest.match(DEVICE_NAMES) || (identityReply ? earlierType || previous.match(DEVICE_NAMES) : null) || (confirmsOwnership ? previous.match(DEVICE_NAMES) : null))?.[1]?.toLowerCase();
  if (!type || /\b(?:don't|do not|no longer) (?:have|own|use)\b|\b(?:hypothetical|for example|imagine|what is a)\b/i.test(latest)) return null;
  if (/^(?:no|nope)[.! ]*$/i.test(latest) && /\b(?:own|have)\b/i.test(previous)) return null;
  const key = value => String(value || '').toLowerCase().replace(/washing machine|washer/g,'washer').replace(/tumble dryer/g,'dryer').replace(/coffee machine/g,'coffee maker').replace(/vacuum cleaner/g,'vacuum');
  const saved = records.filter(item => key(item.type) === key(type));
  if (saved.some(item => item.brand && item.model) && !/\b(?:new|replacement|replaced)\b/i.test(latest)) return null;
  const history = [...exchanges, ...messages.flatMap((item,index) => item.role === 'assistant' && messages[index+1]?.role === 'user' ? [{question:item.content,answer:messages[index+1].content}] : [])];
  const asked = history.filter(item => IDENTITY_QUESTION.test(item.question || '') && (key(item.question).includes(key(type)) || item.question === previous));
  if (asked.some(item => /\b(?:don't know|do not know|not sure|no idea|later|skip|not now|can't find|cannot find)\b/i.test(item.answer || ''))) return null;
  const previousAsksIdentity = IDENTITY_QUESTION.test(previous) && /[?？؟]/u.test(previous);
  if (previousAsksIdentity && /\b(?:model|product number|pnc|e-?nr)\b/i.test(previous)) return null;
  if (previousAsksIdentity && isApplianceIdentityAnswer(latest,previous)) return {type,field:'model'};
  if (asked.length) return null;
  return {type,field:saved.some(item=>item.brand) ? 'model' : 'identity'};
}

export function applianceIntakeGuidance(requirement) {
  if (!requirement) return '';
  return 'APPLIANCE INTAKE REQUIRED: ' + JSON.stringify(requirement) + '. This appliance is relevant to the current routine and has no complete saved identity. Before settling this routine, ask one question for its make if not already stated; otherwise ask its exact model number. Do not ask the make again when the owner just supplied it. When asking for a model, explain a likely label location and that letters, numbers and suffixes matter. If the owner cannot provide it, offer a to-do reminder and wait for consent. Respect an explicit skip or refusal. Never invent identity, features or manual access.';
}
