/**
 * Catch obvious unfinished openings from the language model before they reach
 * the transcript. A one-word lead-in such as "Here's" is not a complete reply.
 * Short complete answers (for example "Yes.") remain valid.
 */
export function isIncompleteAssistantReply(value) {
  const reply = String(value || "").trim();
  if (!reply) return true;
  if (/[.!?…][\s"'”’)}\]]*$/.test(reply)) return false;
  const words = reply.split(/\s+/).filter(Boolean);
  if (words.length > 12) return false;
  return /^(?:here(?:['’]s| is)|there(?:['’]s| is| are)|this is|that is|it is|for example|such as|because|so|and|but|or|with|including|first|next|to start|let me|i(?:['’]m| am| can| could| will| would| should)|you(?: can| could| should| would)|we(?: can| could| should| would))\b/i.test(reply);
}

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


function escapeRegExp(value) {
  return [...String(value)].map((char) => "\\^$.*+?()[]{}|".includes(char) ? "\\" + char : char).join("");
}

function firstPersonSubjectVerb(value) {
  const verb = String(value || "").toLowerCase();
  const fixed = {
    is: "I am", are: "I am", was: "I was", were: "I was",
    has: "I have", have: "I have", does: "I do", do: "I do",
    needs: "I need", need: "I need", "doesn't": "I don't",
    "don't": "I don't", cannot: "I cannot", "can't": "I can't",
    will: "I will", "won't": "I won't", would: "I would",
    "wouldn't": "I wouldn't", should: "I should", "shouldn't": "I shouldn't",
    could: "I could", might: "I might", may: "I may", must: "I must",
    cleans: "I clean", handles: "I handle", helps: "I help", learns: "I learn",
    knows: "I know", understands: "I understand", remembers: "I remember",
    uses: "I use", moves: "I move", asks: "I ask", checks: "I check",
    works: "I work", keeps: "I keep", manages: "I manage", organises: "I organise",
    organizes: "I organize", supports: "I support", notifies: "I notify",
    starts: "I start", stops: "I stop", follows: "I follow", prepares: "I prepare"
  };
  return fixed[verb] || "I " + verb;
}

function rewriteCompanionReferences(value, companionName = "Freya") {
  let reply = String(value || "");
  const robot = "(?:(?:your|the|our|this|that)\\\\s+)?(?:(?:future|home|household|compatible|personal|domestic)\\\\s+)*robot";
  const possessiveRobot = new RegExp("\\\\b" + robot + "(?:'s|’s)\\\\b", "gi");
  reply = reply.replace(possessiveRobot, (match) => preserveInitialCapital(match, "my"));

  const infinitiveTarget = new RegExp(
    "\\\\b((?:want|need|expect|ask|tell|allow|help|teach|remind|prefer|invite|encourage|would like|would prefer)\\\\s+)" + robot + "\\\\s+to\\\\b",
    "gi"
  );
  reply = reply.replace(infinitiveTarget, (match, prefix) =>
    preserveInitialCapital(match, prefix.toLowerCase() + "me to")
  );

  const objectTarget = new RegExp(
    "\\\\b(to|for|with|from|about|by|ask|tell|contact|trust|rely on|depend on)\\\\s+" + robot + "\\\\b",
    "gi"
  );
  reply = reply.replace(objectTarget, (match, prep) =>
    preserveInitialCapital(match, prep.toLowerCase() + " me")
  );

  const subject = new RegExp(
    "\\\\b" + robot + "\\\\s+(can|could|will|would|should|must|might|may|is|are|was|were|has|have|needs|need|does|do|doesn't|can't|cannot|won't|wouldn't|shouldn't|cleans|handles|helps|learns|knows|understands|remembers|uses|moves|asks|checks|works|keeps|manages|organises|organizes|supports|notifies|starts|stops|follows|prepares)\\\\b",
    "gi"
  );
  reply = reply.replace(subject, (match, verb) =>
    preserveInitialCapital(match, firstPersonSubjectVerb(verb))
  );

  const name = String(companionName || "").trim();
  if (name) {
    const escapedName = escapeRegExp(name);
    reply = reply.replace(new RegExp("\\\\b" + escapedName + "(?:'s|’s)\\\\b", "gi"), (match) =>
      preserveInitialCapital(match, "my")
    );
    reply = reply.replace(
      new RegExp("\\\\b(?:to|for|with|from|about|by|ask|tell|contact|trust)\\\\s+" + escapedName + "\\\\b", "gi"),
      (match) => preserveInitialCapital(match, match.split(/\\\\s+/)[0].toLowerCase() + " me")
    );
    reply = reply.replace(
      new RegExp("\\\\b" + escapedName + "\\\\s+(can|could|will|would|should|must|might|may|is|are|was|were|has|have|needs|need|does|do|doesn't|can't|cannot|won't|wouldn't|shouldn't|cleans|handles|helps|learns|knows|understands|remembers|uses|moves|asks|checks|works|keeps|manages|organises|organizes|supports|notifies|starts|stops|follows|prepares)\\\\b", "gi"),
      (match, verb) => preserveInitialCapital(match, firstPersonSubjectVerb(verb))
    );
  }
  return reply;
}

/**
 * Detect an identical or substantially similar assistant response/question in
 * recent conversation history. Short common acknowledgements are not flagged.
 */
export function assistantReplyRepeatsRecentAssistant(value, recentMessages = []) {
  const normalise = (text) => String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\\\\p{L}\\\\p{N}\\\\s]/gu, " ")
    .replace(/\\\\s+/g, " ")
    .trim();
  const stop = new Set([
    "a","an","and","are","as","at","be","but","by","can","could","do","does","for",
    "from","had","has","have","how","i","if","in","is","it","me","my","of","on","or",
    "so","that","the","their","them","then","there","these","they","this","to","up",
    "us","we","what","when","where","which","who","why","will","with","would","you","your"
  ]);
  const tokens = (text) => [...new Set(normalise(text).split(" ").filter((word) => word.length > 2 && !stop.has(word)))];
  const current = normalise(value);
  if (current.length < 9) return false;
  const prior = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((item) => item && item.role === "assistant")
    .slice(-8)
    .map((item) => typeof item === "string" ? item : item.content)
    .filter((text) => typeof text === "string" && normalise(text).length >= 9);

  const currentQuestions = (String(value || "").match(/[^?]{8,}\\\\?/g) || []).map(normalise);
  for (const oldReply of prior) {
    const old = normalise(oldReply);
    if (old === current) return true;

    const oldQuestions = (String(oldReply).match(/[^?]{8,}\\\\?/g) || []).map(normalise);
    for (const question of currentQuestions) {
      const a = tokens(question);
      if (a.length < 3) continue;
      for (const previousQuestion of oldQuestions) {
        const b = tokens(previousQuestion);
        const shared = a.filter((word) => b.includes(word)).length;
        const ratio = shared / Math.min(a.length, b.length || 1);
        if (Math.min(a.length, b.length) >= 3 && ratio >= 0.72) return true;
      }
    }

    const a = tokens(current);
    const b = tokens(old);
    if (a.length >= 9 && b.length >= 9) {
      const shared = a.filter((word) => b.includes(word)).length;
      if (shared / Math.min(a.length, b.length) >= 0.86) return true;
    }
  }
  return false;
}

export function enforceFirstPersonTaskQuestions(value, companionName = "Freya") {
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

  return rewriteCompanionReferences(reply, companionName);
}
