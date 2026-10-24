-- Add Groq-hosted semantic embeddings for meaning-based memory retrieval.
-- Keyword and full-text search remain available as fallbacks.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.synqme_persona_memories
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(768);

CREATE INDEX IF NOT EXISTS synqme_persona_memories_embedding_hnsw
  ON public.synqme_persona_memories
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL
    AND status IN ('user_stated', 'user_confirmed', 'inferred_pending_confirmation', 'conflicting');

CREATE OR REPLACE FUNCTION public.match_synqme_persona_memories(
  query_embedding extensions.vector,
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  score double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $memory_match$
  SELECT
    m.id,
    (1 - (m.embedding <=> query_embedding))::double precision AS score
  FROM public.synqme_persona_memories AS m
  WHERE m.user_id = (SELECT auth.uid())
    AND m.embedding IS NOT NULL
    AND m.status IN ('user_stated', 'user_confirmed', 'inferred_pending_confirmation', 'conflicting')
  ORDER BY m.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 20);
$memory_match$;

REVOKE ALL ON FUNCTION public.match_synqme_persona_memories(extensions.vector, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_synqme_persona_memories(extensions.vector, integer) TO authenticated;

COMMENT ON COLUMN public.synqme_persona_memories.embedding IS
  '768-dimensional Groq-hosted Nomic embedding. The source text remains in statement and search fields; missing embeddings continue to use keyword and full-text retrieval.';
COMMENT ON FUNCTION public.match_synqme_persona_memories(extensions.vector, integer) IS
  'Cosine-similarity retrieval for the current authenticated user only; SECURITY INVOKER preserves row-level security.';
