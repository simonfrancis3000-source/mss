CREATE OR REPLACE FUNCTION public.synqme_touch_persona_memory_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $persona_memory_fn$
BEGIN
  NEW.updated_at := pg_catalog.now();
  NEW.search_document := pg_catalog.to_tsvector(
    'simple',
    coalesce(NEW.statement, '') || ' ' ||
    coalesce(NEW.topic, '') || ' ' ||
    coalesce(NEW.scope_key, '') || ' ' ||
    pg_catalog.array_to_string(NEW.search_terms, ' ')
  );
  RETURN NEW;
END;
$persona_memory_fn$;
