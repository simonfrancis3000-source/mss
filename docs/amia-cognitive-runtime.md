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
| Quality | Structured validation, bounded format/quality repair, action-claim checks, repetition and dead-end checks, stale-result rejection, delivery observations and repeatable evaluations |

The planner ranks objectives and supplies evidence to the language model. Conditional permission evaluation is a conservative decision helper, not a certified robot safety controller. No model-generated action is executed directly.

## Turn lifecycle

`authenticate -> claim -> resolve/context -> propose/validate -> atomic commit -> deliver`

1. Existing authentication obtains the verified account and current training revision. Request body user IDs cannot select another account. The account must pass the rollout allowlist.
2. A stable scenario/turn identity and content fingerprint protect retries. A duplicate completed turn replays its recorded result. Reusing an ID for different text or competing with an active lease returns HTTP 409.
3. Canonical state is loaded from the server, including bounded history and pending offers. Initial state may be seeded from matching scenario-tagged saved messages. Client checkpoints cannot overwrite canonical state.
4. Routine reminder acceptance, pause and grounded resume can bypass the model. Normal conversation uses one DeepSeek JSON-object call with independent validation. Recovery is bounded to three total requests within one deadline, allowing one format repair, one quality repair, or one temporary availability retry. Repeated failures of the same class stop. Exact-model appliance identification can require another composition after official evidence is available, within the overall turn deadline.
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

GitHub workflows run the existing regression/build checks. The Android workflow compiles a debug APK and uploads it for review. A separate workflow attempts 30 synthetic live DeepSeek checks when repository credentials are available. The evaluator uses the same checked-generation helper and bounded recovery budget as the runtime. The report preserves each attempt and separately counts first-pass success, repairs and total model calls. Missing credentials create a report marked `blocked`; workflow success in that case does not mean live-model validation passed.

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


### Advanced programme: latest completed development run

Run [41911343431](https://github.com/simonfrancis3000-source/mss/actions/runs/41911343431) evaluated commit 7fb403831e567ecf8df51b70e0374cfea93a41c1. All 450 development repeats were attempted: 36 passed, 414 failed, and 4,354 of 5,400 planned user turns completed. The reserved cases were not run. Failure codes overlap: stale_preference_active 321, runtime_quality_check_failed 159, relation_target_changed 5, correction_missing 1 and final_recall_missing_current_value 1. The majority of exhausted quality repairs were settled_decision, followed by repeated_question and settled_question.

The following corrections require a fresh live run before their effectiveness can be claimed:

- Receiving a message is distinct from answering the preceding question. A structured, quoted answer annotation records coverage; missing or ungrounded annotations leave the dimension unresolved. Deferred questions remain excluded. This is model-assisted conversational classification, not independent proof of semantic correctness or consent.
- Answer coverage survives the canonical session and decision-state records. Reminder commands do not settle unrelated questions. A substantive grounded answer still prevents repeating the same decision.
- Memory links can follow a version replaced earlier in the same atomic job. Confirmation proposals now process explicit exception links. A different stale job is still rejected rather than silently redirected.
- Correcting a detail in an exception does not prepend the obsolete placement to the replacement. Restrictive permissions remain preserved; confirming a boundary may strengthen an unspecified policy but cannot grant permission.
- Evaluation version 2 checks the original preference scope rather than treating every historical reason mentioning the old value as a current default. It accepts the demonstrated shelf/shelves variation. Conflicting old defaults still fail. Reports identify the grading version; aggregating mixed versions fails completeness checks. Scores across the grading change are not directly comparable.

These are development fixes. Production activation, hosted authenticated PostgREST coverage, device audio and human conversational review remain separate acceptance work.


Additional queue and permission regression coverage:

- An ask-first or prohibited exception is stored as a boundary even if its proposal used kind=exception; the shared legacy cleaner must not discard its restrictive policy.
- A grounded answer in the current turn cannot be followed by a paraphrase of the same decision merely because the answer has not yet been committed to dispositions.
- Two queued extractions for the same precise preference dimension can be generated before the first has a stored key. A grounded explicit correction still supersedes the older preference when the worker catches up. A later-arriving older extraction cannot replace a newer preference. Returning to a previously superseded value creates a fresh version rather than colliding with its retired memory key. Ambiguous changes remain conflicts.

Run [41914625715](https://github.com/simonfrancis3000-source/mss/actions/runs/41914625715) passed all 30 short live generation checks first time, with zero repairs (generation p50 2,203 ms; p95 2,468 ms). These short checks do not establish long-conversation or voice reliability.


### Development evaluation with version 2 grading

Run [41914625415](https://github.com/simonfrancis3000-source/mss/actions/runs/41914625415) completed all 450 development repeats at commit 9507f9f722973a258177ed921158a7f8f48162d2: 428 passed (95.1%), 22 failed, and 5,279 of 5,400 planned user turns completed. The remaining failures were 21 exhausted quality repairs and one circular memory dependency. Reserved cases stayed sealed. This is the first full baseline using the corrected grading rules, so its percentage must not be treated as directly comparable with the preceding grader.

The next revision gives the bounded repair request its rejected draft and a concrete replacement instruction. It validates the visible proposed dependency graph before committing a memory job, allowing the same repair budget to correct a circular proposal while retaining the database cycle guard. Appliance intake now requires an owner mention, a contextual identity answer or confirmed ownership, rather than being triggered by an incidental assistant disclaimer about appliance manuals. Unit regressions cover these failures. Fresh live results are still required for this revision.


### Second development evaluation with unchanged version 2 grading

Run [41992396407](https://github.com/simonfrancis3000-source/mss/actions/runs/41992396407) at ad9723a80d24f7fc97bea5d57df7f1fed2205efb passed 438/450 development repeats (97.3%), failed 12 and completed 5,334/5,400 turns. Every remaining failed conversation exhausted a quality repair; no memory, reminder, correction or dependency failure was reported. Reserved cases stayed sealed. This is comparable to the 428/450 version 2 baseline because the scoring and dataset were unchanged.

The next correction distinguishes a requested recap returning to an unanswered question from repeating a settled question. It also requests separate answer and next_question fields; the server validates and attaches one question, rejects malformed or conflicting follow-ups, avoids attaching duplicates and applies the same action-claim and repetition checks to the composed reply. Legacy proposals already containing a valid follow-up remain compatible. The generation budget remains one request plus at most one repair. Fresh live evaluation is required after this revision.

Reminder detours also return to the current unanswered training question and retain its decision key instead of replacing it with a generic first-step question. Unit and real migration-SQL harness tests cover this continuity.


### Structured-question regression and correction

Run [41994950577](https://github.com/simonfrancis3000-source/mss/actions/runs/41994950577) at 4006ba3a1aa3f40db3d1c9db60ea2994b3c932ac regressed to 332/450 passes, 118 failures and 4,953/5,400 turns. Every failure exhausted the response-quality budget. Most occurred after a reminder detour: the model returned to an unanswered question, the repetition guard rejected it, and the repair often left conflicting draft/question fields. This revision is not release-ready; its score must not be hidden by the earlier 438/450 result.

The next revision makes next_question authoritative and removes draft questions from the answer field before applying the complete response checks. It permits one explicit revisit of an unanswered decision, tracks active asks in canonical state and blocks further repetition of that decision, including paraphrases. Answered and deferred questions stay blocked. Reminder detours, pause/resume and owner-requested recaps do not count as additional active asks. Focused regressions verify these behaviors; a fresh full live run is required.


### Bounded-revisit evaluation and final recovery cases

Run [41997811069](https://github.com/simonfrancis3000-source/mss/actions/runs/41997811069) at fc7430c569fb5abd92a165d0212e875348da7469 passed 448/450 development repeats (99.6%), failed two and completed 5,384/5,400 turns. The two failures were format+quality recovery exhaustion and two consecutive invalid proposal formats. No memory, reminder, correction or dependency failure was recorded. Reserved cases remained sealed.

The next revision identifies the invalid field without logging its raw value and gives that field-specific reason to the format repair. Recovery permits one format repair and one quality repair, with at most three requests only when different failure classes occur. Two consecutive failures of the same class still stop after two requests; ordinary replies still use one. Generation has a 55-second recovery deadline within the runtime's 70-second model deadline, leaving room before the 90-second database lease. This prevents rare mixed recovery failures from exhausting a single shared retry without introducing an unbounded loop. Fresh live evaluation is required for this revision.


### Independent reserved evaluation

Development and reserved phases now run independently against the same frozen runtime and grading revision. This permits the fresh reserved evaluation to proceed when development is highly reliable but still has explicitly reported failures. The reserved phase has its own 150-run/1,800-turn summary; development retains its separate 450-run/5,400-turn summary. The combined 600-run/7,200-turn acceptance check still reports every failure and enforces complete coverage. Running the reserved phase does not convert a failing result into a pass. Runtime and scoring code remain unchanged while this fresh evaluation is in progress.


### First independent reserved result and subsequent corrections

The frozen [600-run evaluation 42001835006](https://github.com/simonfrancis3000-source/mss/actions/runs/42001835006) completed all planned runs: development 447/450 (99.3%), reserved 142/150 (94.7%), combined 589/600 (98.2%), with 7,182/7,200 turns completed. Development had three quality-recovery failures. Eight reserved runs failed correction/stale-preference checks; those failures were not grading-wording errors.

Six correction proposals were discarded because the owner-evidence guard did not recognize first-person preferences with an adverb such as “I now prefer” in a household label containing “guest”. Two proposals supplied an incorrect opaque memory ID or supplied its fact-dimension key instead. The correction now preserves explicit first-person owner evidence and resolves references only through one exact, unique known owner fact dimension. It never fuzzy-matches opaque IDs and rejects ambiguous/foreign references for bounded repair rather than silently losing the correction. Replaying the eight captured provider traces through the corrected runtime and actual migration SQL passed all eight correction checks.

A separate integration review found that the account-context query omitted decision source_refs, which carry durable answer-coverage evidence. The query now retrieves that metadata so older answered questions retain their coverage after they leave the recent canonical session window. A projection-based storage regression verifies it.

The original reserved score remains 142/150 for the frozen revision. These examples have now been inspected and used for remediation. Subsequent runs explicitly label them previously_reserved_regression and cannot be presented as a new untouched final evaluation. A genuinely fresh future acceptance sample or human review is needed to reassess generalization after tuning.

### Completed programme and implementation handoff

[Regression run 42007280471](https://github.com/simonfrancis3000-source/mss/actions/runs/42007280471) at 369d9bc4f4077e8030b58d8d44cd008e5962903b passed 446/450 development repeats and 150/150 previously reserved repeats: 596/600 total (99.3%), with 7,170/7,200 user turns completed. Four failures remained: one stale descriptive memory, two exhausted reply repairs and one temporary model-service failure. The separate 30-check live run 42007280818 passed all checks on their first attempt, with generation p50 2,261 ms and p95 2,758 ms.

The final implementation resolves dependency references to earlier facts in the same batch through exact keys or unique exact scopes. When a fact's supporting preference is replaced, dependent descriptive facts become historical; approval boundaries remain active. Reply repair now receives all detected violations and retains unanswered-question context. Explicit negative save statements are distinguished from unsupported success claims. Temporary provider unavailability permits one retry within the existing three-request/deadline limits; authentication and billing errors do not retry. These final changes have focused deterministic regressions; the 596/600 live score belongs to the preceding frozen revision, not these unmeasured final changes.

At the owner's request, the broad automated programme is stopped. The 600-run programme and short live-provider workflow are now manual, preserving the reports, dataset and checks without automatically purchasing more live-model runs on a code update. Human voice sessions, authenticated hosted-runtime acceptance and controlled activation remain outstanding. The runtime stays disabled by default; no production migration or activation is implied by a passing local check.

Final local verification passed 714 web/backend checks and 674 Android-branch checks, including 155 focused runtime/memory checks. These overlapping software checks do not replace live voice or hosted acceptance.

### Production installation, 5 November 2026

The owner authorized code and database deployment. The runtime, graph and delivery/retention migrations are installed in the hosted project. Web/backend PR #85 is merged at c140f388d5ba1f7d8b88465b41866bf377ddf341, preserving the current billing commits; Render deploy dep-dbm692ivcj2c7385ekug is live. Android PR #87 is merged at 030f0338a2bba5852a2038add3ffdbf0cd9e2d00. This does not publish a new Android bundle to devices. The current OTA manifest targets native code 8 and contains an older bundle.

Hosted service-role verification passed claim, atomic reminder commit and canonical replay in a rolled-back transaction, leaving no test reminder or conversation behind. All new tables have RLS, client writes are denied, and server RPCs are unavailable to anonymous/client roles. A follow-up migration explicitly excludes anonymous authenticated sessions from all three reset-cleanup policies; 15 focused PostgreSQL/operations checks pass. Existing unrelated security advisories are unchanged.

The deployed /health endpoint returns 200; unauthenticated runtime status returns 401. Runtime activation remains off. No authenticated end-to-end model/Phonic session or new Play/OTA release is claimed. Paid live-model workflows remain manual.
