const ROOM_PATTERNS = [
  ["kitchen", /\b(kitchen|dishwasher|dishwashing|cooking|cooktop|oven|fridge|refrigerator|sink|countertop|worktop|pantry)\b/i],
  ["bathroom", /\b(bathroom|bath|shower|toilet|washbasin|vanity)\b/i],
  ["bedroom", /\b(bedroom|bed|wardrobe|closet|nightstand)\b/i],
  ["living_room", /\b(living room|lounge|sofa|couch|television|tv area)\b/i],
  ["laundry", /\b(laundry|washing machine|washer|dryer|clothes|ironing|folding)\b/i],
  ["floors", /\b(floor|vacuum|mop|carpet|hardwood)\b/i]
];

function detectRoom(text) {
  for (const [room, pattern] of ROOM_PATTERNS) {
    if (pattern.test(String(text || ""))) return room;
  }
  return null;
}

function preferenceRoom(preference) {
  const explicit = preference?.explicitFields || {};
  if (typeof explicit.room === "string") return detectRoom(explicit.room) || explicit.room.toLowerCase();
  if (Array.isArray(explicit.rooms) && explicit.rooms.length) return detectRoom(explicit.rooms.join(" ")) || null;
  return detectRoom([preference?.category, preference?.text].filter(Boolean).join(" "));
}

function isGlobalPreference(preference) {
  const value = String(preference?.text || "").toLowerCase();
  return /\b(always|never|every room|all rooms|throughout the home|whole home|any room|any task|household-wide|in general|before any action)\b/.test(value);
}

function wordSet(value) {
  return new Set(String(value || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
}

export function selectRelevantPreferences(preferences = [], messages = []) {
  if (!Array.isArray(preferences) || !preferences.length) return [];
  const recent = Array.isArray(messages) ? messages.slice(-8) : [];
  const recentText = recent.map((item) => item?.content || "").join(" ");
  let activeRoom = null;
  for (const item of [...recent].reverse()) {
    activeRoom = detectRoom(item?.content || "");
    if (activeRoom) break;
  }
  const recentWords = wordSet(recentText);
  const scored = preferences.map((preference, index) => {
    const room = preferenceRoom(preference);
    const global = isGlobalPreference(preference);
    const preferenceWords = wordSet([preference?.category, preference?.text].join(" "));
    let overlap = 0;
    for (const word of preferenceWords) if (recentWords.has(word)) overlap += 1;
    const score = overlap / Math.max(1, preferenceWords.size);
    let eligible = true;
    if (activeRoom && room && room !== activeRoom) eligible = false;
    if (activeRoom && !room && !global && score < 0.12) eligible = false;
    if (!activeRoom && score < 0.08 && !global) eligible = false;
    return { preference, index, score: score + (global ? 0.2 : 0) + (room === activeRoom ? 0.35 : 0), eligible };
  });
  const selected = scored
    .filter((item) => item.eligible)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.preference);
  if (selected.length) return selected;
  return activeRoom ? [] : preferences.slice(-4);
}
