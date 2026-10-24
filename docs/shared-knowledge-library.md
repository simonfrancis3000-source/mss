# SYNQ.ME Shared Household Knowledge Library

## Purpose

Build a cumulative, reusable library of high-quality prompt/answer patterns and household decision principles that improves SYNQ.ME for all users—without pooling raw conversations or creating a cross-user transcript archive.

The system deliberately separates three layers:

1. **Private persona memory** — a user's own preferences and historical conversation, isolated by user ID.
2. **Contribution queue** — an optional, user-owned store of de-identified candidate lessons awaiting review.
3. **Shared knowledge library** — reviewed, general-purpose lessons available to signed-in users. The shared table has no user ID or source transcript field.

## Contribution consent

- Sharing is opt-in and off by default.
- The settings toggle explains that up to six recent chat messages may be sent to the existing AI provider to abstract a reusable lesson.
- The extraction route returns only a candidate pattern; it does not receive a database credential and cannot publish to the shared table.
- The browser inserts only the candidate fields into `synqme_knowledge_candidates`. The database checks that the authenticated user's profile has sharing enabled and that the consent timestamp matches.
- Turning sharing off removes that user's pending review candidates. Approved generic lessons may remain in the shared library without an account link; the settings copy states this.
- The extractor and server validator reject obvious direct identifiers, email/phone/address patterns, first-person personal phrasing, and sensitive domains. This is defence in depth, not a guarantee that every inference or identifier can be detected.

## Ingestion and review lifecycle

1. After an assistant response, an opted-in account may send up to six recent user/assistant messages to `POST /api/knowledge/extract`.
2. Groq is asked to generalise a clearly stated, reusable household preference, decision rule or exception into a generic question, answer pattern, principle, tags, keywords, conditions and limitations.
3. Server-side validation normalises fields and rejects candidates that fail eligibility, category, privacy or content checks. The server calculates a SHA-256 fingerprint for duplicate detection.
4. The browser submits only the generalised candidate to the private queue with `status='pending_review'`; the raw transcript is not inserted into the shared library.
5. A platform reviewer checks usefulness, generalisability, privacy, evidence and safety. Approved lessons are inserted into `synqme_shared_knowledge` with a fingerprint and non-identifying evidence count. Similar candidates from different users can increase that count or be consolidated before promotion.
6. The chat client searches the library by indexed topic and keyword overlap and supplies a small set of approved entries as optional context. Current-user instructions and private memory always take precedence.

New community candidates are not automatically made visible to other users. Review prevents one person's mistaken, malicious or highly specific answer from becoming a platform-wide rule.

## Migrations applied

The migration filenames in this branch intentionally match the live Supabase migration history:

- `20261024195254_add_synqme_home_memory_index.sql`
- `20261024200711_add_synqme_shared_knowledge_library.sql`
- `20261024200918_harden_shared_knowledge_privacy_checks.sql`

The shared-library and privacy-check migrations have been applied to the active MySecondSelf Supabase project and the five curated seed records were verified in the database. Apply pending migrations only through the project's normal migration workflow; do not re-run already-recorded versions manually.

## Database access model

- `synqme_shared_knowledge`: RLS enabled. Authenticated users can select rows only where `status='approved'`. No authenticated insert/update/delete policy is provided, so the browser cannot publish or edit shared entries.
- `synqme_knowledge_candidates`: RLS enabled. Users can select and delete only their own pending submissions. Inserts require `auth.uid() = user_id`, pending status, an active consent flag and a matching consent timestamp in `synqme_profiles`. The browser has no update policy.
- Shared records contain no contributor ID, source message or transcript reference. The candidate queue is still private user data and should be reviewed as such.
- Both tables have GIN indexes over topic/keyword arrays. Retrieval is deterministic keyword/topic matching, not semantic vector search.

## Seeded starting library

The migration inserts five curated starter patterns covering unknown item placement, approved cleaning products, vacuuming obstacles, recurring schedule exceptions and pet-related boundaries. They are marked `source_type='curated_seed'` and have `evidence_count=0`; do not represent them as community-validated findings.

## Manual moderation workflow (initial release)

The first version uses the Supabase SQL Editor as the moderation interface; there is not yet a dedicated admin UI.

List pending candidate patterns:

```sql
SELECT id, category, prompt_pattern, answer_pattern, general_principle,
       context_tags, key_terms, applicability, limitations, fingerprint, created_at
FROM public.synqme_knowledge_candidates
WHERE status = 'pending_review'
ORDER BY created_at DESC;
```

Before promotion, verify that each lesson is genuinely general, does not expose identifying/sensitive facts, preserves important conditions, and does not make claims about unverified robot capabilities. Consolidate duplicates rather than adding repeated variants. When promoting, copy only the generic fields into `synqme_shared_knowledge`, set `source_type='community_derived'`, set a reviewed quality score and evidence count, and mark the reviewed candidate(s) accordingly. Never copy `user_id`, raw messages or personal notes into the shared table.

## Verification and limits

- The migration is applied to the active MySecondSelf Supabase project. Both new tables have RLS enabled, and the shared library has five seeded records.
- The UI, chat server and validation tests are committed on the `SYNQ.ME` branch. Syntax and targeted behaviour checks were run after the changes.
- The full hosted `npm test` and production build are not yet verified because GitHub Actions has been failing before the workflow steps start.
- The new learning flow is not live until the `SYNQ.ME` code is deployed. No candidate has been created from the existing transcript because contribution is opt-in and the new code has not yet run.
- Do not enable automatic promotion without adding stronger duplicate aggregation, abuse detection, reviewer controls and a privacy audit.
