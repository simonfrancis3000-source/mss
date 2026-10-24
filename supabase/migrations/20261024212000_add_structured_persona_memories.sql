-- Structured, user-owned persona memories, separate from raw conversation history
-- and from reusable task playbooks in src/household-skills.js.

CREATE TABLE IF NOT EXISTS public.synqme_persona_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_key text NOT NULL,
  source_preference_id text,
  topic text NOT NULL DEFAULT 'general_household',
  kind text NOT NULL DEFAULT 'preference'
    CHECK (kind IN ('preference', 'routine', 'boundary', 'fact', 'exception')),
  scope_key text NOT NULL DEFAULT 'general_household.preference',
  statement text NOT NULL CHECK (length(trim(statement)) BETWEEN 8 AND 420),
  status text NOT NULL DEFAULT 'user_stated'
    CHECK (status IN ('user_stated', 'user_confirmed', 'inferred_pending_confirmation', 'conflicting', 'superseded', 'archived')),
  relation text NOT NULL DEFAULT 'new'
    CHECK (relation IN ('new', 'refines', 'updates', 'conflicts', 'confirms', 'withdraws', 'no_change')),
  confidence numeric(4,3) NOT NULL DEFAULT 0.750
    CHECK (confidence >= 0 AND confidence <= 1),
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conditions) = 'array'),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  search_terms text[] NOT NULL DEFAULT '{}',
  search_keys text[] NOT NULL DEFAULT '{}',
  source_message text,
  source_timestamp timestamptz,
  source_conversation_key text NOT NULL DEFAULT 'main',
  conflict_group text,
  supersedes_id uuid REFERENCES public.synqme_persona_memories(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  last_used_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_document tsvector NOT NULL DEFAULT ''::tsvector,
  CONSTRAINT synqme_persona_memories_user_key_unique UNIQUE (user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS synqme_persona_memories_user_updated_idx
  ON public.synqme_persona_memories (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS synqme_persona_memories_user_topic_status_idx
  ON public.synqme_persona_memories (user_id, topic, status);

CREATE INDEX IF NOT EXISTS synqme_persona_memories_scope_idx
  ON public.synqme_persona_memories (user_id, scope_key, status);

CREATE INDEX IF NOT EXISTS synqme_persona_memories_search_keys_gin
  ON public.synqme_persona_memories USING gin (search_keys);

CREATE INDEX IF NOT EXISTS synqme_persona_memories_search_document_gin
  ON public.synqme_persona_memories USING gin (search_document);

CREATE OR REPLACE FUNCTION public.synqme_touch_persona_memory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  NEW.updated_at = now();
  NEW.search_document := to_tsvector(
    'simple',
    coalesce(NEW.statement, '') || ' ' ||
    coalesce(NEW.topic, '') || ' ' ||
    coalesce(NEW.scope_key, '') || ' ' ||
    coalesce(array_to_string(NEW.search_terms, ' '), '')
  );
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS synqme_persona_memory_updated_at
  ON public.synqme_persona_memories;

CREATE TRIGGER synqme_persona_memory_updated_at
BEFORE INSERT OR UPDATE ON public.synqme_persona_memories
FOR EACH ROW EXECUTE FUNCTION public.synqme_touch_persona_memory_updated_at();

ALTER TABLE public.synqme_persona_memories ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.synqme_persona_memories TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'synqme_persona_memories'
      AND policyname = 'Users can read their own persona memories'
  ) THEN
    CREATE POLICY "Users can read their own persona memories"
      ON public.synqme_persona_memories FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'synqme_persona_memories'
      AND policyname = 'Users can create their own persona memories'
  ) THEN
    CREATE POLICY "Users can create their own persona memories"
      ON public.synqme_persona_memories FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'synqme_persona_memories'
      AND policyname = 'Users can update their own persona memories'
  ) THEN
    CREATE POLICY "Users can update their own persona memories"
      ON public.synqme_persona_memories FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'synqme_persona_memories'
      AND policyname = 'Users can delete their own persona memories'
  ) THEN
    CREATE POLICY "Users can delete their own persona memories"
      ON public.synqme_persona_memories FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;

COMMENT ON TABLE public.synqme_persona_memories IS
  'Structured, user-owned memories with evidence, scope, conflict state and review metadata. Reusable task procedures live separately in application skill definitions.';
COMMENT ON COLUMN public.synqme_persona_memories.source_message IS
  'Original user wording used as evidence; this is private account data and is subject to the same RLS as the memory.';
COMMENT ON COLUMN public.synqme_persona_memories.status IS
  'Conflicting memories are retained as conflicts until the user resolves them; superseded/archived records are excluded from active retrieval.';
