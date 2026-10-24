import { extractHomeMemoryTopics } from "./home-memory-index.js";

/*
 * Task playbooks are procedural guidance, not personal memory.
 * Keep stable skill steps here; user-specific rules belong in synqme_persona_memories.
 * These playbooks plan rather than execute tasks and must never imply a connected robot.
 */
export const HOUSEHOLD_SKILLS = [
  {
    id: "kitchen-reset",
    title: "Kitchen reset",
    topics: ["kitchen", "food_and_meals", "dishwashing", "waste_and_recycling"],
    steps: [
      "Clarify the user's preferred timing and what counts as finished.",
      "Keep food, dishes, waste and cleaning surfaces as separate decisions where appropriate.",
      "Use only approved products and the user's stated method for each surface.",
      "Do not move personal or unidentified items to make a surface easier to clean; ask or leave them in place.",
      "If the sequence, item destination or product is uncertain, retain that uncertainty rather than guess."
    ]
  },
  {
    id: "surface-care",
    title: "Surface care",
    topics: ["surface_cleaning", "cleaning_supplies", "kitchen", "bathroom"],
    steps: [
      "Identify the surface and use only a compatible, user-approved cleaning method.",
      "Distinguish wiping a clear surface from moving objects that sit on it.",
      "Do not spray electronics, delicate finishes or unidentified materials.",
      "Preserve the user's item-placement boundaries and ask about unresolved product choices."
    ]
  },
  {
    id: "laundry-care",
    title: "Laundry care",
    topics: ["laundry"],
    steps: [
      "Preserve the user's sorting, washing, drying, folding and storage preferences separately.",
      "Check garment-care instructions when available rather than infer a safe temperature or method.",
      "Keep unknown items and items with uncertain care requirements aside for the user.",
      "Treat a new exception as scoped to the items or situation the user described."
    ]
  },
  {
    id: "tidy-with-boundaries",
    title: "Tidying with boundaries",
    topics: ["bedroom", "living_room", "privacy_and_boundaries", "safety_and_access"],
    steps: [
      "Distinguish clutter from belongings that may have been deliberately left where they are.",
      "Put an item away only when its destination is known and moving it is authorised.",
      "Keep private, fragile, sentimental or unidentified items untouched unless the user gives a clear rule.",
      "If a blocked path creates a safety concern, explain the issue and ask rather than silently relocate belongings."
    ]
  },
  {
    id: "pets-and-plants",
    title: "Pets and plants",
    topics: ["pets", "plants"],
    steps: [
      "Use only the care routine and quantities the user has explicitly confirmed.",
      "Do not infer a pet's needs or a plant's condition without supported observations.",
      "If a supply, identification or care requirement is uncertain, stop and ask the user.",
      "Keep pet access, food, water and plant-care routines distinct where their rules differ."
    ]
  },
  {
    id: "home-schedule",
    title: "Household scheduling",
    topics: ["scheduling", "guests"],
    steps: [
      "Record the normal trigger and time separately from exceptions such as guests, calls or a changed morning routine.",
      "Do not treat a proposed schedule as authorised execution.",
      "Respect quiet periods and user-defined do-not-disturb conditions.",
      "When two scheduled actions compete, prefer the user's explicitly prioritised rule and clarify unresolved conflicts."
    ]
  }
];

export function selectHouseholdSkills(query, { limit = 2 } = {}) {
  const text = String(query || "").trim();
  if (!text) return [];
  const topics = new Set(extractHomeMemoryTopics(text));
  const scored = HOUSEHOLD_SKILLS.map((skill) => {
    const hits = skill.topics.filter((topic) => topics.has(topic)).length;
    return { skill, score: hits };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
  return scored.slice(0, Math.max(1, Math.min(3, limit))).map(({ skill }) => ({
    id: skill.id,
    title: skill.title,
    steps: skill.steps
  }));
}
