# AMIA persistence

The existing `synqme_persona_memories` table remains the source of truth for persona rules. It now includes scoped permission policies, bounded conversation source references and automatically maintained rule versions. Unspecified or inferred information never grants permission.

Three account-owned tables complement it:

- `synqme_decision_states`: known, unconfirmed and conflicting references to active rules; unanswered questions, received responses and explicit deferrals. Receiving a response does not mark a decision confirmed.
- `synqme_appliance_references`: normalized appliance identity, manufacturer manual URL, last verification time and latest lookup status. No manual content or downloaded files are saved.
- `synqme_evaluation_records`: runtime observations, user scenario self-reviews and submitted automated test results. Each origin has separate allowed outcomes. Runtime events cannot be represented as passed tests.

An invoker trigger synchronizes rule and appliance records in the same transaction as the existing memory write. Archiving or forgetting a rule removes its derived decision and appliance records. Composite foreign keys prevent links to another account's memories. RLS restricts every new table to the authenticated, registered owner.

The chat backend loads records with the caller's token, supplies relevant saved context to AMIA and records emitted questions using an idempotent, atomic RPC. Both typed chat and the Phonic AMIA tool use this path. RPC observations contain question text and source metadata, but do not duplicate the user's response or model analysis. Storage failure is explicitly returned as `amiaPersistence.status = unavailable` while the conversation reply remains usable.

Existing memory and appliance attributes remain compatible. Legacy manual links without a verification timestamp are imported as unverified and must be checked again. Manufacturer links are revalidated and fetched at use, so a stored flag alone never establishes appliance features.

The 25-scenario completion checklist now saves a `scenario_self_review` event before persisting completion. This is a user report, not an objective assessment of the persona or robot capabilities.

## Save measured scenario tests

Create a JSON report using a stable run ID, one catalogue scenario ID, an engine version and measured assertions:

```json
{
  "run_id": "dishwasher-2026-11-01-001",
  "scenario_id": "room:kitchen",
  "engine_version": "baseline-v1",
  "assertions": [
    {"id": "requires_purchase_approval", "passed": true},
    {"id": "preserves_scraps_exception", "passed": false}
  ]
}
```

Use a dedicated registered test account. Provide `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and its short-lived `SUPABASE_TEST_ACCESS_TOKEN` through the environment, then run:

```sh
node scripts/record-amia-test-result.mjs path/to/report.json
```

The script authenticates the account, computes the overall outcome from the assertions, excludes raw transcripts, and ignores duplicate run IDs. It does not run a model evaluation itself or certify the supplied assertions. Model-driven question ranking and independent behavioural evaluation are subsequent engine work.
