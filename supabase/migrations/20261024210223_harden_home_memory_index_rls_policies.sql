-- Cache auth.uid() per statement rather than re-evaluating it for every archived message row.
DROP POLICY IF EXISTS "Users can read their own home memory"
  ON public.synqme_memory_index;
DROP POLICY IF EXISTS "Users can insert their own home memory"
  ON public.synqme_memory_index;
DROP POLICY IF EXISTS "Users can update their own home memory"
  ON public.synqme_memory_index;
DROP POLICY IF EXISTS "Users can delete their own home memory"
  ON public.synqme_memory_index;

CREATE POLICY "Users can read their own home memory"
  ON public.synqme_memory_index
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert their own home memory"
  ON public.synqme_memory_index
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own home memory"
  ON public.synqme_memory_index
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own home memory"
  ON public.synqme_memory_index
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
