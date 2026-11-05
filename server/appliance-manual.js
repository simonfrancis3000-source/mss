import { parallelManualProvider } from './parallel-research.js';
// Search and fetch public manufacturer documentation through DeepSeek or Parallel. No PDF
// or extracted manual text is persisted. Unknown manufacturers fail closed.
const MANUFACTURERS = {
  bosch: ['bosch-home.com', 'bosch-home.co.uk'],
  siemens: ['siemens-home.bsh-group.com'],
  samsung: ['samsung.com'], lg: ['lg.com'], miele: ['miele.com', 'miele.co.uk'],
  dyson: ['dyson.com', 'dyson.co.uk'], philips: ['philips.com', 'philips.co.uk'],
  whirlpool: ['whirlpool.com', 'whirlpool.co.uk'], electrolux: ['electrolux.com', 'electrolux.co.uk'],
  aeg: ['aeg.com', 'aeg.co.uk'], beko: ['beko.com', 'beko.co.uk'],
  shark: ['sharkclean.com', 'sharkclean.co.uk'], ninja: ['ninjakitchen.com', 'ninjakitchen.co.uk'],
  delonghi: ['delonghi.com'], 'de longhi': ['delonghi.com'],
  kitchenaid: ['kitchenaid.com', 'kitchenaid.co.uk'], irobot: ['irobot.com', 'irobot.co.uk'],
  roborock: ['roborock.com'], panasonic: ['panasonic.com'], breville: ['breville.com'],
  neff: ['neff-home.com'], haier: ['haier.com', 'haier-europe.com'],
  hotpoint: ['hotpoint.com', 'hotpoint.co.uk'], mieleusa: ['mieleusa.com']
};
function canonical(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function manufacturerDomains(brand) {
  const name = String(brand || '').trim().toLowerCase();
  return MANUFACTURERS[name] || MANUFACTURERS[canonical(name)] || [];
}
export function validateManualUrl(raw, domains) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.hostname.endsWith('.')) return null;
    if (!domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null;
    return url.href;
  } catch { return null; }
}
export function exactModelMentioned(model, text) {
  const value = String(model || '').trim();
  if (value.length < 4 || value.length > 80 || !/[0-9]/.test(value)) return false;
  // Preserve separator differences but do not accept a longer neighbouring model.
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_ /]+/g, '[-_ /]*');
  return new RegExp('(?:^|[^a-z0-9])' + escaped + '(?![a-z0-9])', 'i').test(String(text || ''));
}
// Select readable passages from across the returned document instead of only
// its opening pages, where tables of contents often crowd out useful features.
// The provider may return partial content, so callers must never call this a
// complete reading of the manual.
export function manualEvidenceExcerpt(content, maxCharacters = 30000) {
  const text = String(content || '');
  if (text.length <= maxCharacters) return text;
  const windows = [[0, Math.min(6000, text.length)]];
  const feature = /\b(?:wi[ -]?fi|wireless|connect(?:ion|ivity|ed)?|bluetooth|remote (?:control|start)|app|programme|program|cycle|sensor|automatic|delay(?:ed)? start|safety|lock)\b/gi;
  for (const match of text.matchAll(feature)) {
    const start = Math.max(0, match.index - 500), end = Math.min(text.length, match.index + 1000);
    const last = windows.at(-1);
    if (start <= last[1] + 100) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
    if (windows.reduce((total, [a,b]) => total + b - a, 0) >= maxCharacters) break;
  }
  return windows.map(([start,end]) => text.slice(start,end)).join('\n\n[Other sections omitted]\n\n').slice(0,maxCharacters);
}
async function providerCall(path, body, key, fetchImpl, provider = 'deepseek', domains = []) {
  if (provider === 'parallel') return parallelManualProvider(path, body, key, fetchImpl, domains);
  const res = await fetchImpl('https://api.deepseek.com/v1/tools/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error('Documentation service unavailable (' + res.status + ')');
  return res.json();
}
export async function findApplianceManual({ brand, model, type, key, provider = 'deepseek', fetchImpl = fetch, onUsage = async () => {} }) {
  const domains = manufacturerDomains(brand);
  if (!key) return { status: 'not_configured' };
  if (!domains.length) return { status: 'manufacturer_unverified' };
  if (!exactModelMentioned(model, model)) return { status: 'model_incomplete' };
  const query = `${brand} ${model} ${type} user manual`.slice(0, 128);
  let search;
  try { search = await providerCall('search', { query, count: 8, need_content: false }, key, fetchImpl, provider, domains); }
  catch { return { status: 'search_unavailable' }; }
  if (Array.isArray(search.results) && search.results.length && !search.cached) await onUsage('search');
  const candidates = (Array.isArray(search.results) ? search.results : []).map((result) => ({ result, url: validateManualUrl(result?.url, domains) })).filter((item) => item.url).slice(0, 2);
  for (const { result, url } of candidates) {
    let page;
    try { page = await providerCall('fetch', { url, model }, key, fetchImpl, provider, domains); }
    catch { continue; }
    if (typeof page.content !== 'string' || !page.content.trim()) continue;
    if (!page.cached) await onUsage('fetch');
    const text = page.title + '\n' + page.content;
    if (!exactModelMentioned(model, text) || !/\b(manual|user guide|instructions|operating instructions|instruction manual)\b/i.test(String(page.title || '') + ' ' + url)) continue;
    return { status: 'matched', url, excerpt: manualEvidenceExcerpt(page.content) };
  }
  return { status: 'manual_unverified' };
}

const DEVICE_CONTEXT = /\b(dishwasher|washing machine|washer|dryer|tumble dryer|vacuum|hoover|air[ -]?fryer|microwave|coffee (?:maker|machine)|espresso|oven|stove|refrigerator|fridge|freezer|blender|kettle|toaster|appliance|device|machine|model(?: number)?)\b/i;
export function shouldIdentifyAppliance(messages) {
  const list = Array.isArray(messages) ? messages.slice(-8) : [];
  const last = list[list.length - 1];
  if (last?.role !== 'user' || typeof last.content !== 'string' || !/\d/.test(last.content)) return false;
  if (!DEVICE_CONTEXT.test(list.map((item) => item.content || '').join(' '))) return false;
  // A time such as “30 minutes” is not a model number. Numeric-only model
  // numbers are accepted when the user or the preceding question identifies
  // the number as a model, product number, PNC or E-Nr.
  const tokens = last.content.match(/[\p{L}\p{N}][\p{L}\p{N}._/-]{3,79}/gu) || [];
  const modelPrompt = /\b(?:model|product number|pnc|e-?nr)\b/i.test(last.content + ' ' + (list.at(-2)?.role === 'assistant' ? list.at(-2).content : ''));
  return tokens.some(token => /\d/.test(token) && (/\p{L}/u.test(token) || (modelPrompt && /^\d{4,}$/.test(token))));
}
export function validateApplianceIdentity(candidate, messages) {
  const type = String(candidate?.type || '').trim().slice(0, 80);
  const brand = String(candidate?.brand || '').trim().slice(0, 80);
  const model = String(candidate?.model || '').trim().slice(0, 80);
  if (!type || !brand || !model) return null;
  const userText = (messages || []).filter((message) => message.role === 'user').map((message) => message.content).join('\n');
  const last = [...(messages || [])].reverse().find((message) => message.role === 'user')?.content || '';
  if (!canonical(userText).includes(canonical(brand)) || !exactModelMentioned(model, last)) return null;
  return { type, brand, model };
}

export async function readSavedApplianceManual({ brand, model, url, key, provider = 'deepseek', fetchImpl = fetch, onUsage = async () => {} }) {
  const safeUrl = validateManualUrl(url, manufacturerDomains(brand));
  if (!key || !safeUrl || !exactModelMentioned(model, model)) return null;
  try {
    const page = await providerCall('fetch', { url: safeUrl, model }, key, fetchImpl, provider, manufacturerDomains(brand));
    if (typeof page.content !== 'string' || !page.content.trim()) return null;
    if (!page.cached) await onUsage('fetch');
    if (!exactModelMentioned(model, String(page.title || '') + '\n' + page.content) || !/\b(manual|user guide|instructions|operating instructions|instruction manual)\b/i.test(String(page.title || '') + ' ' + safeUrl)) return null;
    return { url: safeUrl, excerpt: manualEvidenceExcerpt(page.content) };
  } catch { return null; }
}
