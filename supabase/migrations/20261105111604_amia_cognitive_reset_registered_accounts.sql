-- Reset cleanup belongs to a registered owner, including anonymous sessions
-- that use the authenticated role in Supabase Auth.
alter policy cognitive_sessions_reset on public.synqme_cognitive_sessions
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true'
 and training_revision<(select r.revision from public.synqme_training_revisions r where r.user_id=(select auth.uid())));
alter policy cognitive_turns_reset on public.synqme_cognitive_turns
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true'
 and training_revision<(select r.revision from public.synqme_training_revisions r where r.user_id=(select auth.uid())));
alter policy cognitive_jobs_reset on public.synqme_memory_jobs
 using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true'
 and server_owned and runtime_revision<(select revision from public.synqme_training_revisions where user_id=(select auth.uid())));
