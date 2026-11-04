# AMIA Cognitive Runtime

## Release status

The six runtime components are implemented and integrated with the existing web and Android source branches. The release keeps Render, Node.js, Supabase, DeepSeek and Phonic. No GPU host or foundation-model training is required. This document distinguishes completed implementation and offline validation from live release checks that require credentials, an isolated database and a physical device.

The runtime is disabled by default. It supports English and Spanish. Other existing voice languages continue through the existing route. The static voice ring, companion identity, account flow and Google Play billing are retained. PEXI remains a future integration boundary; this release cannot operate a physical robot.

## Implemented components

| Component | Implementation |
| --- | --- |
| Memory | Main-turn structured proposals, exact source-quote grounding, conditions, provenance, explicit corrections and withdrawals, retained conflicts, server-owned durable jobs, retry leases, dependency/exception/conflict relations and cycle rejection |
| Context | Canonical account/scenario state, outstanding questions and reminder offers, contextual yes/no handling, cross-session resume, deferred/skipped questions and pause state |
| Planner | Objective ranking using saved rules, unresolved conflicts, dependencies, deferred questions and authoritative room review/completion state |
| Decisions | Server-owned permissions and action allowlist; explicit prohibitions take precedence; missing capability or conditional permission requires waiting or clarification |
| Actions | Atomic reminder create/edit/complete/delete, list/read, exact-model official manual verification and bounded grounded feature quotations |
| Quality | Structured validation, one bounded repair, action-claim checks, repetition and dead-end checks, stale-result rejection, delivery observations and repeatable evaluations |

The planner ranks objectives and supplies evidence to the language model. Conditional permission evaluation is a conservative decision helper, not a certified robot safety controller. No model-generated action is executed directly.

## Turn lifecycle

`authenticate -> claim -> resolve/context -> propose/validate -> atomic commit -> deliver`

1. Existing authentication obtains the verified account and current training revision. Request body user IDs cannot select another account. The account must pass the rollout allowlist.
2. A stable scenario/turn identity and content fingerprint protect retries. A duplicate completed turn replays its recorded result. Reusing an ID for different text or competing with an active lease returns HTTP 409.
3. Canonical state is loaded from the server, including bounded history and pending offers. Initial state may be seeded from matching scenario-tagged saved messages. Client checkpoints cannot overwrite canonical state.
4. Routine reminder acceptance, pause and grounded resume can bypass the model. Normal conversation uses one DeepSeek JSON-object call with independent validation. At most one repair is allowed. Exact-model appliance identification can require another composition after official evidence is available.
5. Memory proposals must quote the latest user message. Sensitive content is excluded; another person's taste is not silently assigned to the owner. Permission to act requires explicit wording. Corrections must target an existing rule and carry explicit correction evidence. An unresolved contradiction remains a conflict.
6. One database transaction mutates an authorized reminder, persists the canonical reply/state, records question dispositions and queues validated memory proposals. A failed transaction cannot report success. Lost HTTP responses recover through idempotent replay.
7. The Node worker persists queued memory without requiring an open browser and without another model request. It uses leases, a batch limit, bounded retry delay and a five-attempt limit. Source text is cleared when a job completes. Existing browser-owned jobs continue to drain during migration; new runtime turns do not enqueue duplicate browser jobs.
8. Text dispatch, audio playback start, completion and interruption are recorded as client observations with sequence checks. These observations do not prove that someone heard or understood the response. Audio arriving from an interrupted tool decision is discarded.

Memory persistence is asynchronous after the durable transaction queues it. `memory_queued` means queued, not already consolidated into persona memory. The memory view refreshes from committed records. Appliance identities and verified metadata are queued in the same mechanism; manual text is not retained there.

## Source map

| Files | Responsibility |
| --- | --- |
| `server/cognitive-core.js`, `cognitive-runtime.js` | State, intent, validation and authoritative turn orchestration |
| `server/cognitive-provider.js` | Existing DeepSeek chat API adapter, bounded JSON output and usage accounting |
| `server/cognitive-store.js` | Server-only PostgREST RPCs, reminders, authoritative review context |
| `server/cognitive-memory.js` | Grounding, correction policy and durable job worker |
| `server/cognitive-planner.js` | Evidence-based objective ranking and permission decisions |
| `server/cognitive-appliance.js` | Existing exact-model official-manual verification and bounded quotations |
| `server/cognitive-rollout.js` | Explicit global enable plus verified account allowlist |
| `src/cognitive-client.js` | Account capability negotiation, turn mapping and delivery observation retries |
| `src/phonic-voice.js`, `src/voice-tool-dedup.js` | Existing Phonic transport, idempotent tool delivery, barge-in fencing |
| `src/audio-quality.js`, `scripts/analyze-phonic-pcm.mjs` | Peak/RMS/clipped-sample diagnostics; no raw-audio upload |
| `evals/cognitive-cases.mjs`, `scripts/evaluate-cognitive-runtime.mjs` | Repeatable fixtures and optional live-model report |

## Database changes

Apply these additive migrations in order:

1. `20261104145805_amia_cognitive_runtime.sql`: scoped sessions, turn ledger, transactional reminder action RPCs and reset invalidation.
2. `20261104152117_amia_cognitive_memory_graph.sql`: durable server-owned memory jobs, transactional enqueue, provenance/supersession/conflicts, rule relations, cycle protection and worker RPCs.
3. `20261104153147_amia_cognitive_delivery_retention.sql`: sequence-checked delivery observations and retention maintenance.

The live production schema was inspected read-only. No production migration or user-data write was performed. Existing persona memories, decision states, appliance records, room journeys, reminders and training revisions are reused.

Transaction functions use SECURITY INVOKER with an empty search path and explicit service-role grants. Anonymous and authenticated callers cannot execute runtime write RPCs. Users can read only their own rows through RLS. Active canonical state cannot be mutated by a browser. Reset locks the training revision before invalidation so a stale worker cannot commit old training. Graph endpoints have owner-scoped composite foreign keys. Server-owned jobs cannot be claimed or edited by the legacy browser worker.

The daily maintenance timer expires response bodies after 90 days while retaining tombstone keys to prevent an old retry repeating an action. Inactive sessions expire after 90 days, finished jobs after 30 days and delivery observations after 90 days. Full account deletion remains governed by the existing account-deletion cascade. Behavioral rollback does not delete a user's reminders.

## Configuration and rollout

Use the backend's existing server-only Supabase key and DeepSeek configuration. Never place service credentials in `VITE_*` variables.

- `AMIA_COGNITIVE_RUNTIME_ENABLED=true` enables runtime capability.
- `AMIA_RUNTIME_USER_IDS` and/or `AMIA_RUNTIME_EMAILS` selects verified test accounts using comma-separated values. An empty allowlist enables nobody.
- The authenticated `/api/runtime/status` endpoint negotiates capability per account; the client caches it briefly and fails closed if unavailable.
- The backend must have all migrations before enabling a test account.
- The existing Phonic API key and transport remain in use.

A code rollout should first use an isolated backend/database with representative schema and dedicated test accounts. Run the real reminder offer/yes/retry/failure sequence, correction across sessions, pause/resume, reset, concurrent devices and voice barge-in. Verify both committed data and the user-visible result. Enable additional accounts only after those checks pass. Disable the flag or remove an account from the allowlist to roll back behavior. Leave additive tables in place to preserve audit and replay records.

The inspected Render workspace contains `synqme-api` on `SYNQ.ME` and `synqme-demo` on `SYNQ.ME`. Their live service identity was checked. The frontend PR preview does not provide an isolated runtime backend, so loading that preview is not an authenticated end-to-end runtime test.

## Verification and limits

Local web verification against current SYNQ.ME: 680 tests pass and production frontend build passes. Local Android verification: 644 tests pass, mobile build passes and Capacitor Android sync passes. The branch-specific count differs because the source branches contain different existing tests.

The tests execute the actual SQL migrations in pinned PGlite/PostgreSQL, including transaction rollback, replay, leases, RLS, owner isolation, reset races, memory grounding, correction/supersession, graph cycles, delivery ordering and expired-response tombstones. This validates database behavior locally; it does not establish that target PostgREST grants are configured correctly before migration.

There are 100 narrow reminder trajectories and 150 additional multi-turn trajectories across ten domains and fifteen behavior families. The broader set covers exceptions, corrections, conflicts, deferrals, pause/resume, reminders, retry, failed writes, malformed/truncated output, settled questions and permissions. Thirty broader fixtures are labeled held-out, but the set is synthetic and template-based. Deterministic mocked-provider passes are orchestration checks, not live-model intelligence scores.

GitHub workflows run the existing regression/build checks. The Android workflow compiles a debug APK and uploads it for review. A separate workflow attempts 30 synthetic held-out live DeepSeek checks when repository credentials are available. The evaluator uses the same checked-generation helper as the runtime, with at most one repair. The report preserves each attempt and separately counts first-pass success, repairs and total model calls. Missing credentials create a report marked `blocked`; workflow success in that case does not mean live-model validation passed.

Local live evaluation records `blocked` because credentials are kept in GitHub rather than this workspace. GitHub now authenticates successfully. Its first authenticated 30-check run passed 29 checks on the first attempt; a quoted example question plus a follow-up triggered the multiple-question guard. The prompt now avoids quoted questions, and the evaluator shares the runtime repair path. The subsequent run 41898684720 passed all 30 checks on the first attempt with zero repairs, generation p50 2,021 ms and p95 2,456 ms. These are synthetic regression checks after prompt tuning, not an untouched independent hold-out or authenticated end-to-end measurement. Its artifact and the latest validation results are linked in the PR. No authenticated new-runtime PostgREST request, physical Android session or Phonic listening session has been performed. Those checks cannot be inferred from mocks, builds, a debug APK or successful CI.

Runtime logs expose phase durations for claim, context, model, manual lookup and commit, along with model-call count, action type and replay status. Existing provider usage accounting receives token usage. The optional live evaluator reports generation p50/p95 and token totals. No unmeasured speed, cost, voice-quality or general-intelligence improvement is claimed. Warm/cold end-to-end latency and subjective clipping quality require actual deployment and listening measurements.

## Commands

- `npm test`
- `npm run build`
- Android source: `npm run build -- --mode mobile` and `npx cap sync android`
- Native CI: `cd android && ./gradlew assembleDebug --no-daemon`
- Live model: `node scripts/evaluate-cognitive-runtime.mjs` with existing server credentials supplied securely
- Local recording diagnostics: `node scripts/analyze-phonic-pcm.mjs /absolute/path/recording.wav`

The supported WAV diagnostic input is PCM16. It reports peak/RMS/clipped samples without sending the recording to a service. These measurements are diagnostic signals; clipped-sample counts alone cannot establish the cause of an audible interruption.
