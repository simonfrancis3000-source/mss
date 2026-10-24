-- Tighten the structured memory policies for scale and index the self-referencing foreign key.
CREATE INDEX IF NOT EXISTS synqme_persona_memories_supersedes_idx
  ON public.synqme_persona_memories (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

DROP POLICY IF EXISTS "Users can read their own persona memories"
  ON public.synqme_persona_memories;
DROP POLICY IF EXISTS "Users can create their own persona memories"
  ON public.synqme_persona_memories;
DROP POLICY IF EXISTS "Users can update their own persona memories"
  ON public.synqme_persona_memories;
DROP POLICY IF EXISTS "Users can delete their own persona memories"
  ON public.synqme_persona_memories;

CREATE POLICY "Users can read their own persona memories"
  ON public.synqme_persona_memories FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create their own persona memories"
  ON public.synqme_persona_memories FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own persona memories"
  ON public.synqme_persona_memories FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete their own persona memories"
  ON public.synqme_persona_memories FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
