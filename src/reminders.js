// Only explicit list requests change data. Free-form conversation is left to AMÏA.
const LIST = '(?:to[ -]?do(?: list| reminders?)?|reminders?(?: list)?)';
const clean = s => String(s || '').trim().replace(/[.!?]+$/g, '').trim();
export function parseReminderCommand(input) {
  const text = clean(input).replace(/^(?:could you|can you|would you)\s+/i, '');
  let m;
  if (new RegExp('^(?:what(?: is|\'s| are) (?:on |in )?(?:my )?' + LIST + '|(?:show|list|read|tell me) (?:me )?(?:my |the )?' + LIST + '|what (?:are|is) my ' + LIST + ')$', 'i').test(text)) return { action:'list' };
  if ((m = text.match(new RegExp('^(?:please )?(?:add|put) (?:a )?(?:to[ -]?do )?reminder (?:to |that )(.+)$','i')))) return { action:'add', title:clean(m[1]) };
  if ((m = text.match(new RegExp('^(?:please )?(?:add|put) (.+?) (?:to|on|onto) (?:my |the )?' + LIST + '$','i')))) return { action:'add', title:clean(m[1]) };
  if ((m = text.match(new RegExp('^(?:please )?(?:mark|set) (.+?) (?:reminder|to[ -]?do) (?:as )?(done|complete|completed)$','i')))) return { action:'complete', query:clean(m[1]) };
  if ((m = text.match(new RegExp('^(?:please )?(?:remove|delete) (.+?) (?:from|off) (?:my |the )?' + LIST + '$','i')))) return { action:'delete', query:clean(m[1]) };
  if ((m = text.match(/^(?:please )?(?:remove|delete) (?:the |my )?(.+?) reminder$/i))) return { action:'delete', query:clean(m[1]) };
  if ((m = text.match(/^(?:please )?(?:change|edit|rename) (?:the |my )?(.+?) reminder to (.+)$/i))) return { action:'edit', query:clean(m[1]), title:clean(m[2]) };
  if (/\b(?:reminders?|to[ -]?do list)\b/i.test(text) && /\b(?:add|put|remove|delete|edit|change|mark|complete|show|list|read|remind)\b/i.test(text)) return {action:'help'};
  return null;
}
const norm = value => clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export function matchReminder(items, query) {
  const target = norm(query).replace(/^(?:the|my)\s+/, '').replace(/\s+(?:reminder|to do)$/, '').trim();
  if (!target || /^(?:it|this|that|one|all|everything)$/.test(target)) return { status:'ambiguous' };
  const exact = items.filter(item => norm(item.title) === target);
  if (exact.length === 1) return {status:'matched',item:exact[0]};
  const found = items.filter(item => norm(item.title).includes(target));
  return found.length === 1 ? {status:'matched',item:found[0]} : {status:found.length ? 'ambiguous':'missing'};
}
export function validReminderTitle(value) {
  const title=clean(value);
  return title.length >= 3 && title.length <= 500 && !/^(?:it|this|that|one|something)$/i.test(title) ? title : '';
}
