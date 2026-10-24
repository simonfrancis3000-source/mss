const KNOWLEDGE_CATEGORIES = new Set([
  "kitchen", "bathroom", "vacuuming", "surface_cleaning", "cleaning_supplies",
  "laundry", "bedroom", "living_room", "pets", "plants", "food_and_meals",
  "guests", "privacy_and_boundaries", "scheduling", "safety_and_access",
  "waste_and_recycling", "general_household"
]);
const KNOWLEDGE_TOPICS = new Set(KNOWLEDGE_CATEGORIES);

function looksPersonallyIdentifiableOrSensitive(value) {
  const text = String(value || "");
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) ||
    /\b(?:https?:\/\/|www\.)\S+/i.test(text) ||
    /\b(?:my name is|i live at|my address is|my phone number|my email address|my postcode|my zip code|passport number|social security number|bank account number)\b/i.test(text) ||
    /\b\d{1,4}\s+(?:[\w'-]+\s+){0,4}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way|close|place|pl|boulevard|blvd)\b/i.test(text) ||
    /\b(?:diagnosis|medical history|medication|prescription|religion|religious beliefs|political affiliation|sexual orientation|ethnicity|racial identity|bank balance|salary|immigration status|passport|national insurance|social security)\b/i.test(text) ||
    /\b(?:\+?\d[\d\s().-]{7,}\d)\b/.test(text);
}

function cleanStringList(input, { limit = 12, maxLength = 80, allowSet = null } = {}) {
  if (!Array.isArray(input)) return [];
  const output = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const value = item.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/\s+/g, " ").slice(0, maxLength);
    if (!value || (allowSet && !allowSet.has(value)) || output.includes(value)) continue;
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

export function cleanKnowledgeCandidate(input) {
  if (!input || typeof input !== "object" || input.eligible !== true) return null;
  const category = KNOWLEDGE_CATEGORIES.has(input.category) ? input.category : null;
  const promptPattern = typeof input.prompt_pattern === "string" ? input.prompt_pattern.trim().slice(0, 240) : "";
  const answerPattern = typeof input.answer_pattern === "string" ? input.answer_pattern.trim().slice(0, 700) : "";
  const generalPrinciple = typeof input.general_principle === "string" ? input.general_principle.trim().slice(0, 500) : "";
  const contextTags = cleanStringList(input.context_tags, { limit: 8, maxLength: 48, allowSet: KNOWLEDGE_TOPICS });
  const keyTerms = cleanStringList(input.key_terms, { limit: 24, maxLength: 40 });
  const limitations = Array.isArray(input.limitations)
    ? input.limitations.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 220)).filter(Boolean).slice(0, 5)
    : [];
  const applicabilityInput = input.applicability && typeof input.applicability === "object" && !Array.isArray(input.applicability)
    ? input.applicability
    : {};
  const applicability = {
    conditions: cleanStringList(applicabilityInput.conditions, { limit: 6, maxLength: 160 }),
    exceptions: cleanStringList(applicabilityInput.exceptions, { limit: 6, maxLength: 160 }),
    caution: cleanStringList(applicabilityInput.caution, { limit: 4, maxLength: 160 })
  };
  const fullText = [promptPattern, answerPattern, generalPrinciple, ...contextTags, ...keyTerms, ...limitations,
    ...applicability.conditions, ...applicability.exceptions, ...applicability.caution].join(" ");
  if (!category || promptPattern.length < 8 || answerPattern.length < 8 || generalPrinciple.length < 8 ||
      !contextTags.length || !keyTerms.length || looksPersonallyIdentifiableOrSensitive(fullText)) {
    return null;
  }
  if (/\b(?:i|me|my|mine|we|our|ours|myself|my partner|my child|my children)\b/i.test(fullText)) return null;
  return {
    eligible: true,
    category,
    prompt_pattern: promptPattern,
    answer_pattern: answerPattern,
    general_principle: generalPrinciple,
    context_tags: contextTags,
    key_terms: keyTerms,
    applicability,
    limitations
  };
}
