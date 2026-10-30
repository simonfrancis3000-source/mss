export function normaliseVoicePreference(value) {
  return String(value || "").trim().toLowerCase() === "male" ? "male" : "female";
}

export function phonicVoiceIdForPreference(value) {
  return normaliseVoicePreference(value) === "male" ? "grant" : "sabrina";
}

function preserveInitialCapital(match, replacement) {
  return /^[A-Z]/.test(match)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

/**
 * Keep task questions in the user's companion's first-person voice.
 * This is a deterministic final guard for common third-person robot questions;
 * the conversational prompts also enforce the rule in every supported language.
 */
export function enforceFirstPersonTaskQuestions(value) {
  let reply = String(value || "");

  const questionWords = "(what(?:\\s+(?:tasks|kind\\s+of\\s+tasks|sort\\s+of\\s+things))?|how|when|where|which)";
  const robotDescription = "(?:(?:future|home|household)\\s+)*robot";

  const youWantRobotTo = new RegExp(
    "\\b" + questionWords + "\\s+(?:would|do|can|should)\\s+you\\s+(?:like|want)\\s+(?:your|the|our)\\s+" + robotDescription + "\\s+to\\b",
    "gi"
  );
  reply = reply.replace(youWantRobotTo, (match, question) =>
    preserveInitialCapital(match, question.toLowerCase() + " would you like me to")
  );

  const robotShould = new RegExp(
    "\\b" + questionWords + "\\s+(?:should|could|can)\\s+(?:your|the|our)\\s+" + robotDescription + "\\b",
    "gi"
  );
  reply = reply.replace(robotShould, (match, question) =>
    preserveInitialCapital(match, question.toLowerCase() + " would you like me to")
  );

  const wouldYouLikeRobotTo = new RegExp(
    "\\bwould you like (?:your|the|our)\\s+" + robotDescription + "\\s+to\\b",
    "gi"
  );
  reply = reply.replace(wouldYouLikeRobotTo, (match) =>
    preserveInitialCapital(match, "would you like me to")
  );

  const doYouWantRobotTo = new RegExp(
    "\\bdo you want (?:your|the|our)\\s+" + robotDescription + "\\s+to\\b",
    "gi"
  );
  reply = reply.replace(doYouWantRobotTo, (match) =>
    preserveInitialCapital(match, "would you like me to")
  );

  return reply;
}
