import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { hash } from '../server/cognitive-core.js';

// Execute the actual migration/functions in WASM PostgreSQL, not a SQL-string
// assertion. The bootstrap models the existing tables used by this migration.
test('cognitive migration: atomicity, leases, resets, replay and RLS in PostgreSQL', async t => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const scope = 'room:kitchen';
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
      insert into auth.users values('${owner}'),('${other}');
      create table public.synqme_conversations(user_id uuid primary key references auth.users, messages jsonb not null default '[]');
      create table public.synqme_training_revisions(user_id uuid primary key references auth.users,revision bigint not null default 0);
      alter table public.synqme_training_revisions enable row level security;
      grant select,insert,update on public.synqme_training_revisions to authenticated;
      create policy revision_owner on public.synqme_training_revisions for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
    `);
    await db.exec(await readFile(new URL('../docs/todo-reminders.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261104145805_amia_cognitive_runtime.sql', import.meta.url), 'utf8'));
    await db.exec('set role service_role');
    const claim = async (id, content = id, who = owner, revision = 0, area = scope) => (await db.query('select public.claim_synqme_cognitive_turn($1::uuid,$2::bigint,$3,$4,$5) v', [who,revision,area,hash(area + id),hash(content)])).rows[0].v;
    const commit = async (id, lease, { action = null, state = { messages: [] }, who = owner, revision = 0, area = scope } = {}) => (await db.query('select public.commit_synqme_cognitive_turn($1::uuid,$2::bigint,$3,$4,$5::uuid,$6::jsonb,$7::jsonb,$8::jsonb) v', [who,revision,area,hash(area+id),lease,JSON.stringify(state),JSON.stringify({ reply: 'Added to your reminders.', runtime: { action: action?.type || null } }),action ? JSON.stringify(action) : null])).rows[0].v;

    await t.test('committed reminder and turn replay produce one effect', async () => {
      const c = await claim('one');
      const done = await commit('one', c.lease, { action: { type: 'add', title: 'Find the hob model' } });
      assert.equal(done.status, 'completed'); assert.ok(done.result.runtime.actionId);
      assert.equal((await claim('one')).status, 'completed');
      assert.equal((await commit('one', c.lease)).status, 'completed');
      assert.equal((await db.query('select count(*)::int n from public.synqme_reminders')).rows[0].n, 1);
      await assert.rejects(claim('one', 'different input'), /runtime_turn_conflict/);
    });

    await t.test('unexpired session lease rejects a concurrent turn', async () => {
      const c = await claim('two');
      await assert.rejects(claim('three'), /runtime_busy/);
      await commit('two', c.lease);
    });

    await t.test('constraint failure rolls back the reminder and response together', async () => {
      const c = await claim('bad-state');
      await assert.rejects(commit('bad-state', c.lease, { action: { type: 'add', title: 'Must roll back' }, state: { oversized: 'x'.repeat(140000) } }));
      assert.equal((await db.query("select count(*)::int n from public.synqme_reminders where title='Must roll back'")).rows[0].n, 0);
      assert.equal((await db.query('select status from public.synqme_cognitive_turns where turn_key=$1', [hash(scope+'bad-state')])).rows[0].status, 'in_progress');
      await db.query('select public.release_synqme_cognitive_turn($1::uuid,0,$2,$3,$4::uuid)', [owner,scope,hash(scope+'bad-state'),c.lease]);
    });

    await t.test('expired lease is fenced off when another worker claims', async () => {
      const old = await claim('old-worker');
      await db.query("update public.synqme_cognitive_sessions set lease_until=clock_timestamp()-interval '1 second' where user_id=$1::uuid", [owner]);
      const current = await claim('new-worker');
      await assert.rejects(commit('old-worker', old.lease, { action: { type: 'add', title: 'Stale effect' } }), /runtime_stale_lease/);
      await commit('new-worker', current.lease);
    });

    await t.test('a reminder owned by another user cannot be edited or deleted', async () => {
      const otherClaim = await claim('other', 'other', other);
      const result = await commit('other', otherClaim.lease, { who: other, action: { type: 'add', title: 'Other owner reminder' } });
      const c = await claim('cross-owner');
      await assert.rejects(commit('cross-owner', c.lease, { action: { type: 'delete', id: result.result.runtime.actionId } }), /runtime_reminder_changed/);
      await db.query('select public.release_synqme_cognitive_turn($1::uuid,0,$2,$3,$4::uuid)', [owner,scope,hash(scope+'cross-owner'),c.lease]);
    });

    await t.test('authenticated owner can read, cannot mutate runtime or call server RPCs', async () => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      await db.exec('set role authenticated');
      const rows = (await db.query('select distinct user_id from public.synqme_cognitive_sessions')).rows;
      assert.deepEqual(rows.map(r => r.user_id), [owner]);
      await assert.rejects(db.query("update public.synqme_cognitive_sessions set state='{}'"), /permission denied/);
      await assert.rejects(claim('client-forged'), /permission denied/);
      await db.query("delete from public.synqme_cognitive_sessions where user_id=$1::uuid", [owner]);
      assert.equal((await db.query('select count(*)::int n from public.synqme_cognitive_sessions')).rows[0].n, 1);
    });

    await t.test('training reset deletes canonical memory and invalidates stale turns', async () => {
      await db.exec('reset role; set role service_role');
      const old = await claim('before-reset');
      await db.exec('reset role; set role authenticated');
      await db.query('update public.synqme_training_revisions set revision=revision+1 where user_id=$1::uuid', [owner]);
      assert.equal((await db.query('select count(*)::int n from public.synqme_cognitive_sessions')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int n from public.synqme_cognitive_turns')).rows[0].n, 0);
      await db.exec('reset role; set role service_role');
      await assert.rejects(commit('before-reset', old.lease), /runtime_revision_changed/);
      const fresh = await claim('fresh', 'fresh', owner, 1);
      assert.deepEqual(fresh.state.messages, []);
      await commit('fresh', fresh.lease, { revision: 1 });
    });

    await t.test('anonymous roles cannot read private runtime data or call RPCs', async () => {
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query('select * from public.synqme_cognitive_turns'), /permission denied/);
      await assert.rejects(claim('anonymous'), /permission denied/);
    });
  } finally { await db.close(); }
});
