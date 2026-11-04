# AMIA Cognitive Runtime: first implementation tranche

## Current status

This branch starts the architectural release described in the MSS build brief. It implements a server-owned turn controller, durable scoped continuation state, transactional reminder actions, a structured provider adapter and deterministic quality checks. It is a reviewable foundation, not a claim that the entire six-component intelligence system is finished or deployed.

The default production path is unchanged. Set `AMIA_COGNITIVE_RUNTIME_ENABLED=true` only on an isolated test deployment after applying and verifying the migration. Version negotiation also requires a client sending `runtimeVersion: 1`. This initial runtime supports English and Spanish; other languages retain the existing route. Both Chat and Phonic Talk reach the same controller through `requestAIReply`.

## Audit findings

- `server/index.js` currently builds a text-only DeepSeek response and can make multiple additional correction/continuity calls. Existing storage records question observations after generation, but does not own the whole turn.
- `src/synqme.js` currently intercepts reminders in the browser. Natural-language offers are recognized using `src/appliance-reminders.js`; persistence depends on that browser path succeeding.
- Existing resume helpers derive checkpoints from supplied transcripts. The new runtime prefers the canonical scoped state committed on the server.
- Supabase already contains persona memory, decision states, appliance references, evaluation records, training revisions, reminders and memory jobs. These are reused. The live schema was inspected read-only; no live DDL or user data mutation was performed for this branch.
- The repository's `SYNQ.ME` branch contains the application backend/frontend. Work started at `cf244d610bedd9bbbc68db5b95376d5e4c7d8b22`; the subsequent Google Play diagnostics through `8032008837adb046b85eaaaf3a97842b5f3c58e1` were retained.
- Deployment-to-commit identity has not been independently verified in Render. No workspace was selected in the connected Render session; no workspace switch or production deployment was attempted.

## Runtime ownership

| Component | Implemented in this tranche | Further work |
| --- | --- | --- |
| Memory Engine | Retrieves ranked existing rules, exceptions, permissions and source references; refuses to treat failed retrieval as empty memory | Move memory extraction/consolidation and graph relations into durable server-owned processing |
| Context Engine | Resolves explicit reminder commands and contextual acceptance/cancellation against persisted offers | Broader multilingual and ambiguous-reference evaluations |
| Conversation Planner | Supplies current objective, unresolved question, dispositions and conflict context to one normal model call | Evidence-driven objective ranking and authoritative coverage beyond the existing client review flow |
| Decision Intelligence | Server-owned action allowlist and consent checks; existing permission rules supplied as evidence | Full conditional dependency graph, calibrated priorities and stronger counterfactual evaluation |
| Action Engine | Transactional reminder add/edit/complete/delete; read/list; idempotent result replay; stale-worker fencing | Integrate additional tools and verified appliance lookup parity before general rollout |
| Quality Engine | Structured response validation, bounded repair, action-claim checks, repetition/dead-end checks | Live-model semantic and multilingual evaluation; hardware listening and delivery acknowledgement |

These are modules within the existing Node service, not six network services. The normal path uses one DeepSeek call. Routine reminder acceptance, pause and grounded resume can avoid a model call. Invalid proposals get at most one repair. DeepSeek and Phonic are retained.

## Turn lifecycle

`authenticate -> claim -> resolve/context -> propose/validate -> atomic commit -> return`

1. The existing API authentication obtains the verified user. Request body user IDs never select an account.
2. `turnIdentity` combines the scenario and a stable client turn ID/timestamp. The ledger checks a fingerprint to reject reusing an ID with changed content.
3. `claim_synqme_cognitive_turn` serializes a user's scope with a 90-second lease. A duplicate completed turn returns its recorded result. An active competing turn gets HTTP 409. An expired worker cannot commit after another worker claims.
4. Initial continuation state is seeded from matching scenario-tagged saved messages, never from a client's claimed checkpoint. Untagged legacy messages are not guessed into a scenario.
5. The model returns a validated proposal. It cannot execute tools. Its `actions` array must be empty in this tranche. Accepted offers and explicit reminder commands are resolved and authorized by server code.
6. `commit_synqme_cognitive_turn` performs the reminder mutation, writes the canonical reply, and replaces continuation state in one transaction. Any constraint/write failure rolls back the reminder too. The server returns success only after this transaction completes.
7. A lost HTTP response is recoverable: retrying the same turn returns the completed ledger entry. Release after an uncertain timeout never removes a completed result.

The legacy conversation JSON remains the existing UI/history projection. Cognitive sessions and turns are authoritative for negotiated runtime turns. They do not assert that audio was heard: committed text means generated and persisted, not playback completed.

## Persistence and permissions

Migration: `supabase/migrations/20261104145805_amia_cognitive_runtime.sql`.

- `synqme_cognitive_sessions` stores bounded recent context, last question, pending offer, question dispositions and lease/version fields per account and scenario.
- `synqme_cognitive_turns` stores canonical turn results scoped by account, training revision and stable turn key.
- New table writes and transaction RPCs are restricted to `service_role`. The backend reuses its existing server-only `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`; never place these in `VITE_*` variables.
- Functions use `SECURITY INVOKER` and an empty search path. Explicit grants revoke execution from public, anonymous and authenticated callers.
- Authenticated users can read only their own records. Delete permission applies only to invalidated revisions so the existing training-reset caller can clear obsolete data without mutating active state.
- Every claim/commit/release checks and locks the training revision. Reset invalidates stale in-flight turns. The reset revision trigger physically removes old canonical context and turn records. A scenario reset conservatively invalidates all runtime continuation state for the account while the existing scenario reset decides which persona rules/history survive.
- Reminders are user-managed list data and retain the existing reset semantics. Runtime history deletion does not silently delete a user's reminder list.

No existing transcript or persona backfill is required. Seeding happens lazily for matching tagged history. This branch does not save complete manuals, provider secrets or raw audio in the runtime tables. Both new tables contain private conversation data and must follow the same user deletion and retention policy as the existing conversation store. A durable retention/archival policy for the turn ledger is still required before broad use; do not prune recent idempotency keys during active sessions.

## Verification performed

- Existing baseline: 363 tests passed before edits.
- Full current suite: 489 tests, including the independent diagnostics update; final results are recorded in the PR validation report.
- Production frontend build passed with original public assets restored for local verification.
- PostgreSQL tests execute the actual migration and transaction functions using pinned PGlite, not SQL text matching. They cover atomic rollback, replay, busy/stale leases, cross-user reminder mutation, authenticated read/write restrictions, anonymous denial and reset invalidation.
- 100 synthetic multi-turn reminder trajectories cover five appliance details, five acceptance forms and four lifecycle paths (retry, pause/resume, transaction failure, cancellation). Twenty cases are labelled held-out, but share the same synthetic template families. This is a narrow deterministic integration set, not an independently sampled evaluation of general conversation intelligence.
- Additional controller/provider/API tests check truncation repair, failed retrieval, unverified action claims, fingerprint conflicts, concurrent requests and verified account selection.
- Voice adapter tests cover deduplication and retry behavior. No claim is made about improved clipping or subjective voice quality without listening tests.

No live DeepSeek requests, authenticated web/device sessions, production migrations or Phonic listening tests were run. Runtime latency measured with deterministic fixtures is not representative of provider/network latency and is not presented as a production speed improvement.

## Isolated rollout and rollback

1. Review this PR and the migration against the target project's grants, reset functions and service-role configuration.
2. Apply the migration to an isolated Supabase environment with representative schema and test accounts; run the local PostgreSQL tests and an actual PostgREST RPC test there.
3. Deploy this branch to a test backend/client. Ensure the backend has its server-only key and current DeepSeek configuration. Enable `AMIA_COGNITIVE_RUNTIME_ENABLED=true` only there.
4. Exercise the real hob flow, retry/lost-response case, pause/resume, cross-device use and reset in Chat and Phonic Talk. Check Profile reflects committed reminders.
5. Complete the missing integrations and evaluation listed below before deciding on production rollout.
6. Roll back behavior by disabling the flag. Leave the additive migration in place: it is compatible with old clients and preserves audit/replay results. Disabling the flag does not reverse reminders already created. Do not drop tables as a behavioral rollback.

## Next implementation work

1. Bring verified appliance/manual lookup into the negotiated runtime, including usage accounting and revalidation. Current legacy lookup remains available on the default path; do not enable broad runtime rollout while this parity gap remains.
2. Move durable preference extraction/corrections into server-controlled jobs using the existing memory-job infrastructure. Preserve conditions, provenance, supersession and explicit permissions.
3. Add relational decision dependencies/exception/conflict links using existing rule IDs; validate with scenario trajectories rather than completion-by-message-count.
4. Strengthen objective selection with authoritative review state and a diverse evaluation set of 100–200 real-world-style conversations across all required behaviors. The current 100 reminder variants are only its first narrow family.
5. Diagnose actual Phonic clipping with recordings/measurements and add truthful playback/interruption delivery states. Preserve the static ring and current robot identity/UI.
6. Measure warm/cold p50/p95 latency and costs using the real providers, then optimize the measured bottlenecks.
7. Verify Android source/build integration separately: this PR targets `SYNQ.ME`, not the independent `mobile/current-mss` branch.
8. Add an account allowlist/staged rollout mechanism, retention controls and operational metrics before enabling for multiple real users.

The next implementation phase does not require replacing DeepSeek, Phonic, Render or Supabase, and does not require GPU hosting.
