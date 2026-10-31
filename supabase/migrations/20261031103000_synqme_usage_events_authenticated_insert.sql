revoke all on table public.synqme_usage_events from anon;
grant insert on table public.synqme_usage_events to authenticated;

drop policy if exists synqme_usage_events_insert_own on public.synqme_usage_events;
create policy synqme_usage_events_insert_own
on public.synqme_usage_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);
