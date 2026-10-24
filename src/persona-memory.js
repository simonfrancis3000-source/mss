import { extractHomeMemoryKeys, extractHomeMemoryTopics } from "./home-memory-index.js";

export const MEMORY_TOPICS = new Set([
  "kitchen", "bathroom", "vacuuming", "surface_cleaning", "cleaning_supplies",
  "laundry", "bedroom", "living_room", "pets", "plants", "food_and_meals",
  "guests", "privacy_and_boundaries", "scheduling", "safety_and_access",
  "waste_and_recycling", "general_household"
]);
export const MEMORY_KINDS = new Set(["preference", "routine", "boundary", "fact", "exception"]);
export const MEMORY_STATUSES = new Set([
  "user_stated", "user_confirmed", "inferred_pending_confirmation",
  "conflicting", "superseded", "archived"
]);
export const MEMORY_RELATIONS = new Set([
  "new", "refines", "updates", "conflicts", "confirms", "withdraws", "no_change"
]);

const STOP_WORDS = new Set([
  "about","after","again","also","and","are","because","before","but","can","could","did",
  "does","doing","for","from","get","got","has","have","how","into","just","like","make",
  "most","much","need","not","now","only","our","own","please","should","some","than",
  "that","the","their","them","then","there","these","they","this","those","what","when",
  "where","which","who","why","will","with","would","you","your","yours"
]);
const SENSITIVE_MEMORY_PATTERN = /\b(?:password|passcode|pin code|access code|door code|alarm code|api key|secret key|social security|passport number|credit card|bank account|political party|religious affiliation|sexual orientation|medical diagnosis|immigration status|exact home address|home address|street address|my address|email address|phone number|phone is|ssn)\b/i;
const SENSITIVE_ATTRIBUTE_PATTERN = /password|passcode|pin|access|alarm|credential|secret|token|address|email|phone|bank|credit|medical|health|politic|religion|sexual|immigration|passport|government.?id|ssn/i;

export function normaliseMemoryText(value) {
  return String(value || "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function makePersonaMemoryKey(value) {
  const normalised = normaliseMemoryText(value);
  return normalised ? "mem-" + fnv1a(normalised) : "";
}

export function deriveMemoryKind(value) {
  const text = String(value || "");
  if (/\b(never|must not|do not|don't|without asking|ask me before|check with me|permission|keep .*where it is|leave .* alone)\b/i.test(text)) return "boundary";
  if (/\b(always|usually|every day|daily|morning|afternoon|evening|after breakfast|before breakfast|schedule|routine|twice a day|once a week)\b/i.test(text)) return "routine";
  if (/\b(if|unless|only when|except|otherwise|but when)\b/i.test(text)) return "exception";
  return "preference";
}

export function deriveMemoryTopic(value, category = "") {
  const topics = extractHomeMemoryTopics(String(category || "") + " " + String(value || ""));
  return topics[0] || "general_household";
}

export function deriveMemoryScopeKey(value, topic, kind) {
  const words = normaliseMemoryText(value).split(" ")
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .slice(0, 5);
  return [topic || "general_household", kind || "preference", ...words.slice(0, 3)]
    .join(".").replace(/[^a-z0-9._-]/g, "").slice(0, 120);
}

export function buildPersonaMemorySearchKeys(statement, searchTerms = [], topic = "") {
  const text = [statement, topic, ...(Array.isArray(searchTerms) ? searchTerms : [])].filter(Boolean).join(" ");
  const keys = new Set(extractHomeMemoryKeys(text));
  for (const term of Array.isArray(searchTerms) ? searchTerms : []) {
    const key = normaliseMemoryText(term);
    if (key) keys.add("phrase:" + key.slice(0, 60));
  }
  return [...keys].slice(0, 100);
}

function cleanStringList(value, maxItems = 8, maxLength = 140) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/\u0000/g, "").trim().slice(0, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

export function cleanPersonaMemoryCandidate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const statement = typeof input.statement === "string"
    ? input.statement.replace(/\u0000/g, "").trim().replace(/\s+/g, " ").slice(0, 420)
    : "";
  if (statement.length < 8 || SENSITIVE_MEMORY_PATTERN.test(statement)) return null;

  const inferredTopic = deriveMemoryTopic(statement);
  const topic = MEMORY_TOPICS.has(input.topic) ? input.topic : inferredTopic;
  const kind = MEMORY_KINDS.has(input.kind) ? input.kind : deriveMemoryKind(statement);
  const scopeCandidate = typeof input.scope_key === "string"
    ? normaliseMemoryText(input.scope_key).replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "").slice(0, 120)
    : "";
  const scope_key = scopeCandidate || deriveMemoryScopeKey(statement, topic, kind);
  const relation = MEMORY_RELATIONS.has(input.relation) ? input.relation : "new";
  const confidence = Number.isFinite(Number(input.confidence))
    ? Math.max(0, Math.min(1, Number(input.confidence)))
    : 0.75;
  const attributes = input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes)
    ? Object.fromEntries(Object.entries(input.attributes)
        .filter(([key, value]) => !SENSITIVE_ATTRIBUTE_PATTERN.test(String(key)) &&
          !(typeof value === "string" && SENSITIVE_MEMORY_PATTERN.test(value)))
        .slice(0, 12)
        .map(([key, value]) => [
          String(key).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48),
          typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
            ? value
            : Array.isArray(value) ? value.filter((v) => ["string", "number", "boolean"].includes(typeof v) &&
              !(typeof v === "string" && SENSITIVE_MEMORY_PATTERN.test(v))).slice(0, 8)
            : undefined
        ]).filter(([key, value]) => key && value !== undefined))
    : {};
  const conditions = cleanStringList(input.conditions, 8, 180)
    .filter((condition) => !SENSITIVE_MEMORY_PATTERN.test(condition));
  const searchTerms = cleanStringList(input.search_terms, 16, 80)
    .filter((term) => !SENSITIVE_MEMORY_PATTERN.test(term));
  const status = MEMORY_STATUSES.has(input.status) && ["user_stated","user_confirmed","inferred_pending_confirmation"].includes(input.status)
    ? input.status
    : "user_stated";

  return {
    statement,
    topic,
    kind,
    scope_key,
    relation,
    target_memory_key: typeof input.target_memory_key === "string" ? input.target_memory_key.trim().slice(0, 180) : "",
    confidence,
    status,
    conditions,
    attributes,
    search_terms: searchTerms
  };
}

export function shouldExtractPersonaMemory(message, preferenceWasAdded = false) {
  const text = String(message || "").trim();
  if (text.length < 8 || text.length > 1600 || SENSITIVE_MEMORY_PATTERN.test(text)) return false;
  if (preferenceWasAdded) return true;
  return /\b(i prefer|i like|i dislike|i hate|i usually|i always|i never|i want|i need|i would rather|my routine|our routine|please (?:always|never)|make sure|remember that|don't move|do not move|never move|ask me before|check with me before|keep .* (?:clear|closed|open|separate|where)|after breakfast|before breakfast|every morning|every evening|twice a day|once a week|from now on|instead of|no longer|actually,?)\b/i.test(text);
}

export function memoryIsActive(memory) {
  return Boolean(memory) && !["superseded", "archived"].includes(memory.status);
}

export function rankPersonaMemories(query, memories, { limit = 8 } = {}) {
  const queryText = String(query || "").trim();
  if (!queryText || !Array.isArray(memories)) return [];
  const queryKeys = new Set(buildPersonaMemorySearchKeys(queryText));
  const queryTopics = new Set(extractHomeMemoryTopics(queryText));
  const prepared = memories.map((memory) => {
    if (!memoryIsActive(memory) || typeof memory.statement !== "string" || !memory.statement.trim()) return null;
    const keys = new Set(Array.isArray(memory.search_keys) && memory.search_keys.length
      ? memory.search_keys
      : buildPersonaMemorySearchKeys(memory.statement, memory.search_terms, memory.topic));
    let overlaps = 0;
    for (const key of queryKeys) if (keys.has(key)) overlaps++;
    const topicHit = queryTopics.includes(memory.topic) ? 1 : 0;
    if (!overlaps && !topicHit) return null;
    const statusWeight = memory.status === "conflicting" ? 1.2 : memory.status === "user_confirmed" ? 1.4 : 1;
    const confidence = Number.isFinite(Number(memory.confidence)) ? Number(memory.confidence) : 0.6;
    const date = Date.parse(memory.updated_at || memory.source_timestamp || memory.created_at || "") || 0;
    const recency = date ? Math.min(1, date / Date.now()) : 0;
    return {
      memory,
      score: topicHit * 6 + Math.min(overlaps, 10) * 0.9 + confidence * 1.2 + statusWeight + recency * 0.25
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(16, limit)))
    .map(({ memory }) => memory);
  return prepared;
}

export function preferenceToPersonaMemory(preference, userId) {
  if (!preference || typeof preference.text !== "string" || !preference.text.trim() || !userId) return null;
  const statement = preference.text.trim().slice(0, 420);
  if (statement.length < 8 || SENSITIVE_MEMORY_PATTERN.test(statement)) return null;
  const topic = deriveMemoryTopic(statement, preference.category);
  const kind = deriveMemoryKind(statement);
  const id = String(preference.id || makePersonaMemoryKey(statement)).slice(0, 180);
  const confidence = preference.status === "user_confirmed" ? 0.95 : 0.82;
  return {
    user_id: userId,
    memory_key: "preference-" + id,
    source_preference_id: String(preference.id || "").slice(0, 180) || null,
    topic,
    kind,
    scope_key: deriveMemoryScopeKey(statement, topic, kind),
    statement,
    status: ["user_confirmed", "inferred_pending_confirmation"].includes(preference.status) ? preference.status : "user_stated",
    relation: "new",
    confidence,
    conditions: Array.isArray(preference.unresolvedFields) ? preference.unresolvedFields.slice(0, 8) : [],
    attributes: preference.explicitFacets && typeof preference.explicitFacets === "object" ? preference.explicitFacets : {},
    search_terms: [],
    search_keys: buildPersonaMemorySearchKeys(statement, [], topic),
    // Keep a concise memory statement here, not a duplicate of the full raw chat turn.
    source_message: statement,
    source_timestamp: preference.recordedAt || new Date().toISOString(),
    source_conversation_key: "main",
    archived_at: null
  };
}
