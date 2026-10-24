-- Anonymous Supabase Auth sessions also assume the "authenticated" database role.
-- Shared knowledge and contribution access are reserved for registered, non-anonymous accounts.
DROP POLICY IF EXISTS "Signed-in users can read approved shared knowledge"
  ON public.synqme_shared_knowledge;
CREATE POLICY "Registered users can read approved shared knowledge"
  ON public.synqme_shared_knowledge
  FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND (select auth.jwt() ->> 'is_anonymous') = 'false'
  );

DROP POLICY IF EXISTS "Users can view their own knowledge candidates"
  ON public.synqme_knowledge_candidates;
CREATE POLICY "Registered users can view their own knowledge candidates"
  ON public.synqme_knowledge_candidates
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select auth.jwt() ->> 'is_anonymous') = 'false'
  );

DROP POLICY IF EXISTS "Consented users can insert pending knowledge candidates"
  ON public.synqme_knowledge_candidates;
CREATE POLICY "Registered users with consent can insert pending knowledge candidates"
  ON public.synqme_knowledge_candidates
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND (select auth.jwt() ->> 'is_anonymous') = 'false'
    AND status = 'pending_review'
    AND EXISTS (
      SELECT 1
      FROM public.synqme_profiles AS p
      WHERE p.user_id = (select auth.uid())
        AND p.share_anonymized_learning IS TRUE
        AND p.share_learning_consent_at = consent_at
    )
  );

DROP POLICY IF EXISTS "Users can delete their own knowledge candidates"
  ON public.synqme_knowledge_candidates;
CREATE POLICY "Registered users can delete their own pending knowledge candidates"
  ON public.synqme_knowledge_candidates
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = user_id
    AND (select auth.jwt() ->> 'is_anonymous') = 'false'
    AND status = 'pending_review'
  );
