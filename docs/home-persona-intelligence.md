# SYNQ.ME Home Persona Intelligence

## Purpose

SYNQ.ME should help a person build a useful digital persona for a future compatible home robot. Freya must answer what the person actually said, preserve the details and exceptions they give, and surface relevant home-robot questions they might not have thought to specify. She should not behave like a generic chatbot or a long onboarding form.

This is a Groq inference and conversation-orchestration improvement. It does **not** train a new foundation model, implement an independently verified causal simulator, or mean a physical robot has been connected.

## Current implementation

- src/home-persona-reasoning.js constructs the home-persona reasoning instructions and a bounded context summary.
- server/index.js adds those instructions to its existing Freya system prompt **on the server**, then calls Groq. The browser's system messages are filtered out by the server, so the prompt must remain server-owned.
- The existing user message history, profile, preference records, selected domestic interests, pending clarification, and repair-mode flag are passed into the prompt builder.
- Groq remains the sole model provider. The default is openai/gpt-oss-120b, with high reasoning effort; GROQ_REASONING_EFFORT can override the effort. A legacy GROQ_MODEL=openai/gpt-oss-20b value is upgraded to the 120B default, while another explicitly configured model is preserved.
- public/sw.js uses shell cache synqme-shell-v33; the change does not deliberately delete stored voice/model caches.
- test/home-persona-reasoning.test.js covers prompt content, persona context, recently asked questions, and malformed/missing input. npm test is part of the GitHub Actions build workflow.

## Reasoning principles translated from the Dropbox Veyra / Inca Labs material

1. **Decision and persona state:** use the conversation, saved preferences, explicit facets, unresolved fields, and current task to understand the user's actual intention.
2. **Regret-driven counterfactuals:** consider plausible ways that following a preference literally could cause a bad outcome, as well as ways that excessive caution or repeated questions could frustrate the user.
3. **Weak-signal and cross-domain discovery:** when relevant, look beyond the obvious task to its links with pets, other household members, objects, timing, privacy, supplies, access, and other routines.
4. **Causal path discipline:** do not surface a concern merely because it is semantically associated. The scenario must have a credible cause → intermediate step → consequence path tied to the user's actual goal.
5. **Value of information:** privately compare possible follow-up questions and choose the single question most likely to improve future robot behaviour, based on uncertainty, consequences, reversibility, materiality, and whether the answer changes an action.
6. **Evidence and contradiction discipline:** distinguish user-stated information from inference, unknowns, conflicts, and context-bound rules. Preserve plausible alternatives until a material distinction is resolved. Do not invent observations, capabilities, confidence scores, or causal-model results.
7. **Versioned context:** when a new answer clarifies or changes a prior preference, treat it as a clarification rather than erasing the earlier context. Do not assume silence equals permission.
8. **Visual/sensor boundary:** if future app features supply images or sensor observations, keep the observation separate from its interpretation and respect the provenance and limits of that input. The current chat does not claim camera or sensor access.
9. **Governed action:** distinguish autonomous actions, actions requiring confirmation, and actions that must not be attempted. The user retains authority over a future robot's behaviour.
10. **Continuous learning boundary:** the prompt uses the existing account/persona context in each turn. It does not implement anonymous cross-user learning, differential privacy, reinforcement-learning training, quantum optimization, or live external weak-signal monitoring.

## Quality bar for a useful follow-up

A good follow-up:
- is directly connected to the last user turn and does not repeat a recent question;
- reveals a meaningful exception, dependency, boundary, or failure/recovery case;
- could change what the future robot should do, when it should do it, or when it should ask/stop;
- is concrete, easy to answer, and limited to one main question;
- avoids alarmism, fabricated premises, unsupported hardware claims, and intrusive curiosity.

Example: if a user says “put away anything left on the kitchen counter”, the useful question is not “what else should I know?” It might be whether the robot should move an unfamiliar item when it cannot identify the right storage place, because guessing could misplace a personal item. That is a grounded counterfactual tied to a clear action boundary.

## Limitations and verification status

The implementation is a stronger server-side system prompt plus a larger reasoning model, not a trained model or a formal causal graph engine. The next engineering step is a real evaluation set of home scenarios with expected behaviour, including non-obvious follow-ups, repetition avoidance, multi-part preferences, conflicts, consent, pets/children, privacy, and uncertainty. Results should be scored for relevance, novelty, factual grounding, usefulness, and question repetition before describing this capability as independently verified.

GitHub Actions currently fails before executing any workflow steps because GitHub assigns no runner (runner_id: 0, empty runner name). Therefore the hosted npm test and production build are **not yet verified**, although the relevant JavaScript files have passed syntax checks and the prompt-builder smoke checks available in this session.
