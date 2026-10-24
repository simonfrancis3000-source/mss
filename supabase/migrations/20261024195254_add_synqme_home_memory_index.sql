-- Searchable, per-message home memory archive.
-- The existing synqme_conversations row remains the active transcript; this table
-- preserves indexed message records so references remain discoverable as that
-- rolling transcript grows and older messages fall outside its retained window.

CREATE TABLE IF NOT EXISTS public.synqme_memory_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_key text NOT NULL DEFAULT 'main',
  source_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  message_timestamp timestamptz,
  topics text[] NOT NULL DEFAULT '{}',
  search_keys text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_key)
);

CREATE INDEX IF NOT EXISTS synqme_memory_index_user_timestamp_idx
  ON public.synqme_memory_index (user_id, message_timestamp DESC);

CREATE INDEX IF NOT EXISTS synqme_memory_index_search_keys_gin
  ON public.synqme_memory_index USING gin (search_keys);

CREATE INDEX IF NOT EXISTS synqme_memory_index_topics_gin
  ON public.synqme_memory_index USING gin (topics);

ALTER TABLE public.synqme_memory_index ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.synqme_memory_index TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'synqme_memory_index'
      AND policyname = 'Users can read their own home memory'
  ) THEN
    CREATE POLICY "Users can read their own home memory"
      ON public.synqme_memory_index
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'synqme_memory_index'
      AND policyname = 'Users can insert their own home memory'
  ) THEN
    CREATE POLICY "Users can insert their own home memory"
      ON public.synqme_memory_index
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'synqme_memory_index'
      AND policyname = 'Users can update their own home memory'
  ) THEN
    CREATE POLICY "Users can update their own home memory"
      ON public.synqme_memory_index
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'synqme_memory_index'
      AND policyname = 'Users can delete their own home memory'
  ) THEN
    CREATE POLICY "Users can delete their own home memory"
      ON public.synqme_memory_index
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END
$$;
