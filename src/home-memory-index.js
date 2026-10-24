const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "any", "are", "around", "because",
  "before", "being", "between", "both", "but", "can", "could", "did", "does",
  "doing", "done", "each", "for", "from", "get", "got", "has", "have", "here",
  "how", "into", "just", "like", "maybe", "more", "most", "much", "need", "not",
  "now", "only", "our", "out", "over", "own", "really", "should", "some", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "too", "under", "very", "was", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your", "yours"
]);

const HOME_TOPICS = [
  { id: "kitchen", pattern: /\b(kitchen|countertops?|counter tops?|worktops?|food prep|cook(?:ing)? area|hob|stove|oven|dishwasher|dishes|kettle|crumbs|fridge|refrigerator|cupboards?|pantry)\b/i },
  { id: "bathroom", pattern: /\b(bathrooms?|restroom|toilet|shower|bathtub|bath mat|vanity|toiletries|en[- ]suite)\b/i },
  { id: "vacuuming", pattern: /\b(vacuum(?:s|ed|ing)?|hoover(?:s|ed|ing)?|carpets?|rugs?|mop(?:s|ped|ping)?|sweep(?:s|ing)?|floor cleaning|pet hair|crumbs on the floor)\b/i },
  { id: "surface_cleaning", pattern: /\b(surface cleaning|wipe(?:s|d|ing)?|worktops?|countertops?|dust(?:s|ed|ing)?|polish(?:es|ed|ing)?|microfibre|microfiber|cleaning cloths?|spray cleaner)\b/i },
  { id: "cleaning_supplies", pattern: /\b(cleaning products?|cleaners?|detergents?|bleach|disinfectant|paper towels?|sponges?|microfibre|microfiber|spray bottles?|supplies)\b/i },
  { id: "laundry", pattern: /\b(laundry|washing machine|washer|tumble dryer|dryer|washing clothes|fold(?:ing)? clothes|ironing|delicates|laundry basket|wardrobe)\b/i },
  { id: "bedroom", pattern: /\b(bedroom|bed sheets?|bedding|pillows?|duvet|mattress|bedside table)\b/i },
  { id: "living_room", pattern: /\b(living room|lounge|sofa|couch|coffee table|television|tv stand)\b/i },
  { id: "pets", pattern: /\b(pets?|dogs?|puppies|cats?|kittens|pet bowls?|litter tray|litter box|pet hair|dog bed)\b/i },
  { id: "plants", pattern: /\b(plants?|houseplants?|watering|plant pots?|soil|fertili[sz]er)\b/i },
  { id: "food_and_meals", pattern: /\b(cook(?:ing)?|meal prep|meals?|breakfast|lunch|dinner|ingredients?|leftovers?|food|recipe|fridge|refrigerator)\b/i },
  { id: "guests", pattern: /\b(guests?|visitors?|friends over|people coming over|dinner party|party|entertaining)\b/i },
  { id: "privacy_and_boundaries", pattern: /\b(privacy|private|permission|ask first|ask me first|personal belongings|personal items|leave it alone|leave them alone|do not move|don't move|never move|throw away|discard)\b/i },
  { id: "scheduling", pattern: /\b(morning|afternoon|evening|overnight|bedtime|after breakfast|after lunch|after dinner|before breakfast|schedule|routine|twice a day|daily|every day)\b/i },
  { id: "safety_and_access", pattern: /\b(cables?|wires?|stairs?|steps?|doorways?|door|locked|unlocked|fragile|breakable|hot surfaces?|sharp objects?|trip hazard)\b/i },
  { id: "waste_and_recycling", pattern: /\b(rubbish|trash|garbage|recycling|recycle|compost|food waste|bin|bins|waste)\b/i }
];

const TOPIC_SYNONYMS = new Map([
  ["hoover", "vacuuming"], ["hoovering", "vacuuming"], ["vacuum", "vacuuming"],
  ["carpet", "vacuuming"], ["rug", "vacuuming"], ["mop", "vacuuming"],
  ["restroom", "bathroom"], ["toilet", "bathroom"], ["shower", "bathroom"],
  ["worktop", "kitchen"], ["countertop", "kitchen"], ["hob", "kitchen"],
  ["washer", "laundry"], ["dryer", "laundry"], ["laundering", "laundry"],
  ["sofa", "living_room"], ["couch", "living_room"],
  ["puppy", "pets"], ["kitten", "pets"], ["houseplant", "plants"]
]);

function normaliseText(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, " ").replace(/[’']/g, "").replace(/\s+/g, " ").trim();
}

export function extractHomeMemoryTopics(value) {
  const text = String(value || "");
  const topics = new Set();
  for (const topic of HOME_TOPICS) {
    if (topic.pattern.test(text)) topics.add(topic.id);
  }
  const words = normaliseText(text).split(" ");
  for (const word of words) {
    const mapped = TOPIC_SYNONYMS.get(word);
    if (mapped) topics.add(mapped);
  }
  return [...topics];
}

export function extractHomeMemoryKeys(value) {
  const text = String(value || "");
  const keys = new Set(extractHomeMemoryTopics(text).map((topic) => "topic:" + topic));
  const words = normaliseText(text).split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  for (const word of words.slice(0, 60)) keys.add("word:" + word);
  return [...keys];
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function messageTimestamp(message) {
  const value = message?.timestamp || message?.message_timestamp || message?.created_at || null;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function buildHomeMemoryIndexRows(messages, userId, conversationKey = "main") {
  if (!Array.isArray(messages) || !userId) return [];
  const valid = messages.map((message, index) => ({
    message,
    index,
    role: message?.role,
    content: typeof message?.content === "string" ? message.content.trim().slice(0, 4000) : "",
    timestamp: messageTimestamp(message)
  })).filter((item) =>
    (item.role === "user" || item.role === "assistant") && item.content
  );

  return valid.map((item, position) => {
    const neighbours = [valid[position - 1], item, valid[position + 1]].filter(Boolean);
    const keys = new Set();
    const topics = new Set();
    for (const neighbour of neighbours) {
      for (const key of extractHomeMemoryKeys(neighbour.content)) keys.add(key);
      for (const topic of extractHomeMemoryTopics(neighbour.content)) topics.add(topic);
    }
    const stableTimestamp = item.timestamp || ("legacy-" + item.index);
    const sourceHash = fnv1a(item.role + "\n" + stableTimestamp + "\n" + item.content);
    return {
      user_id: userId,
      conversation_key: conversationKey,
      source_key: stableTimestamp.replace(/[^a-zA-Z0-9]/g, "").slice(-24) + "-" + sourceHash,
      role: item.role,
      content: item.content,
      message_timestamp: item.timestamp,
      topics: [...topics],
      search_keys: [...keys]
    };
  });
}

export function rankHomeMemoryCandidates(query, messages, { limit = 6 } = {}) {
  if (!Array.isArray(messages) || !String(query || "").trim()) return [];
  const queryKeys = new Set(extractHomeMemoryKeys(query));
  const queryTopics = new Set(extractHomeMemoryTopics(query));
  if (!queryKeys.size) return [];

  const prepared = messages.map((message, index) => {
    const ownContent = typeof message?.content === "string" ? message.content.trim() : "";
    const precomputedKeys = message?.search_keys || message?.searchKeys;
    const candidateKeys = new Set(Array.isArray(precomputedKeys) && precomputedKeys.length
      ? precomputedKeys
      : extractHomeMemoryKeys(ownContent));
    const candidateTopics = new Set([
      ...(Array.isArray(message?.topics) ? message.topics : []),
      ...extractHomeMemoryTopics(ownContent)
    ]);
    let topicHits = 0;
    let wordHits = 0;
    for (const topic of queryTopics) if (candidateTopics.has(topic)) topicHits++;
    for (const key of queryKeys) if (candidateKeys.has(key)) {
      if (key.startsWith("topic:")) topicHits++;
      else wordHits++;
    }
    if (!ownContent || (!topicHits && !wordHits)) return null;
    const role = message?.role === "assistant" ? "assistant" : "user";
    const timestamp = messageTimestamp(message);
    const parsedTime = timestamp ? Date.parse(timestamp) : 0;
    const recency = parsedTime ? Math.max(0, Math.min(1, parsedTime / Date.now())) : index / Math.max(1, messages.length);
    const score = topicHits * 5 + Math.min(wordHits, 8) * 0.8 + (role === "user" ? 2 : 0) + recency * 0.5;
    return {
      role,
      content: ownContent.slice(0, 900),
      timestamp,
      topics: [...candidateTopics],
      score
    };
  }).filter(Boolean);

  const unique = new Map();
  for (const item of prepared.sort((a, b) => b.score - a.score || Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))) {
    const signature = item.role + "\n" + normaliseText(item.content);
    if (!unique.has(signature)) unique.set(signature, item);
  }
  return [...unique.values()].slice(0, Math.max(1, Math.min(12, limit))).map(({ role, content, timestamp, topics }) => ({
    role,
    content,
    timestamp,
    topics: topics.slice(0, 8)
  }));
}
