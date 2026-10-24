# SYNQ.ME Home Persona Intelligence

## Purpose

SYNQ.ME should help a person build a useful digital persona for a future compatible home robot. Freya must answer what the person actually said, preserve the details and exceptions they give, and surface relevant home-robot questions they might not have thought to specify. She should not behave like a generic chatbot or a long onboarding form.

This is a Groq inference and conversation-orchestration improvement. It does **not** train a new foundation model, implement an independently verified causal simulator, or mean a physical robot has been connected.

## Current implementation

- src/home-persona-reasoning.js constructs the home-persona reasoning instructions and a bounded context summary.
- server/index.js adds those instructions to its existing Freya system prompt **on the server**, then calls Groq. The browser's system messages are filtered out by the server, so the prompt must remain server-owned.
- The existing user message history, profile, preference records, selected domestic interests, pending clarification, and repair-mode flag are passed into the prompt builder.
- Groq remains the sole model provider. The default is openai/gpt-oss-120b, with high reasoning effort; GROQ_REASONING_EFFORT can override the effort. A legacy GROQ_MODEL=openai/gpt-oss-20b value is upgraded to the 120B default, while another explicitly configured model is preserved.
- public/sw.js uses shell cache synqme-shell-v35; the change does not deliberately delete stored voice/model caches.
- test/home-persona-reasoning.test.js covers prompt content, persona context, recently asked questions, and malformed/missing input. test/home-memory-index.test.js covers topic synonyms, short-answer context, stable message keys and relevance ranking. npm test is part of the GitHub Actions build workflow.

## Conversation persistence and searchable memory

- The current UI is a single rolling conversation, not a multi-thread chat archive. It stores up to 5,000 transcript messages in browser localStorage and the per-user `synqme_conversations` Supabase row; preference records are maintained separately and capped at 24.
- Before this change, the model received only the latest 20 transcript messages (each message is capped at 1,200 characters in the API request). Older preferences could still be saved but fall outside the immediate conversational context.
- `src/home-memory-index.js` builds topic and keyword keys for room/task concepts (for example, kitchen, bathroom, vacuum/hoover, laundry, pets, supplies and privacy). It propagates keys from an adjacent assistant question so short replies such as “twice a day” can be retrieved with the topic that prompted them.
- Each user's messages are archived in `public.synqme_memory_index` with row-level security, searchable topic/keyword arrays, a GIN index, timestamp and source key. On account load, SYNQ.ME backfills the retained transcript once; subsequent saves index the newest two messages. A new user message is queued for account save before the model response, and relevant archived references are retrieved by indexed keyword/topic overlap and sent to the server as bounded historical context.
- Retrieval is a deterministic keyword/topic index, not semantic vector search. It is intentionally small and quick, and can fall back to the current browser transcript when the database index is unavailable. It does not claim to understand every paraphrase; the topic aliases can be expanded using real conversation examples.
- **Live database status (24 October 2026):** the migration has been applied to the active MySecondSelf Supabase project; the new table has RLS enabled and currently contains zero rows. The latest inspected transcript table contains one active transcript with 211 retained messages. The application changes are on branch `SYNQ.ME`; the archive backfill will run when that client code is deployed and the signed-in account loads. Until then, keyword retrieval uses only the browser's retained transcript. The migration can backfill only messages still present in the retained transcript at rollout time; any earlier content already trimmed away cannot be reconstructed from this app's current data.
- The current product has one primary conversation stream. The archive includes a `conversation_key` so future multi-chat threads can be separated, but the UI does not yet create or switch among separate conversation IDs.
- The separate shared household knowledge library is documented in `docs/shared-knowledge-library.md`. It is opt-in, keeps private user memories separate, stores only generalized candidates in a per-user moderation queue, and retrieves only approved non-attributed entries. Five curated starter patterns are present in the live database; community candidate ingestion is not live until the branch is deployed and a user opts in.

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
