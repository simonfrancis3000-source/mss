-- AMIA persistence extends existing account-owned rules. No manual files or
-- transcripts are duplicated into these stores.
ALTER TABLE public.synqme_persona_memories
  ADD COLUMN permission_policy text NOT NULL DEFAULT 'unspecified'
    CHECK (permission_policy IN ('unspecified','ask_first','allowed','prohibited')),
  ADD COLUMN source_refs jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(source_refs)='array' AND jsonb_array_length(source_refs)<=8 AND octet_length(source_refs::text)<=4096),
  ADD COLUMN rule_version integer NOT NULL DEFAULT 1 CHECK (rule_version>0),
  ADD CONSTRAINT synqme_rules_user_id_unique UNIQUE (user_id,id),
  ADD CONSTRAINT synqme_rule_permission_evidence CHECK
    (permission_policy='unspecified' OR (kind='boundary' AND status<>'inferred_pending_confirmation')),
  ADD CONSTRAINT synqme_rule_supersedes_owner FOREIGN KEY (user_id,supersedes_id)
    REFERENCES public.synqme_persona_memories(user_id,id) ON DELETE SET NULL (supersedes_id);

CREATE TABLE public.synqme_decision_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_key text NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 180),
  decision_key text NOT NULL CHECK (length(decision_key) BETWEEN 1 AND 180),
  topic text NOT NULL DEFAULT 'general_household' CHECK (length(topic)<=80),
  source_memory_id uuid,
  question text CHECK (length(question) BETWEEN 1 AND 600),
  status text NOT NULL CHECK (status IN ('known','unconfirmed','conflicting','unanswered','response_received','deferred')),
  source_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_refs)='array' AND jsonb_array_length(source_refs)<=8 AND octet_length(source_refs::text)<=4096),
  last_asked_at timestamptz,
  responded_at timestamptz,
  asked_count integer NOT NULL DEFAULT 0 CHECK (asked_count>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,scope_key,decision_key),
  UNIQUE (user_id,source_memory_id),
  FOREIGN KEY (user_id,source_memory_id) REFERENCES public.synqme_persona_memories(user_id,id) ON DELETE CASCADE,
  CHECK ((source_memory_id IS NOT NULL AND question IS NULL AND status IN ('known','unconfirmed','conflicting'))
    OR (source_memory_id IS NULL AND question IS NOT NULL AND status IN ('unanswered','response_received','deferred')))
);
CREATE INDEX synqme_decision_scope_status ON public.synqme_decision_states(user_id,scope_key,status,updated_at DESC);

CREATE TABLE public.synqme_appliance_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_memory_id uuid NOT NULL,
  appliance_key text NOT NULL CHECK (length(appliance_key) BETWEEN 1 AND 180),
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 80),
  brand text NOT NULL CHECK (length(brand) BETWEEN 1 AND 80),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
  manual_url text CHECK (length(manual_url)<=2048 AND manual_url ~ '^https://[^[:space:]]+$'),
  manual_status text NOT NULL DEFAULT 'unverified' CHECK (manual_status IN
    ('matched','unverified','not_configured','manufacturer_unverified','model_incomplete','search_unavailable','manual_unverified')),
  verified_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,appliance_key),
  UNIQUE(user_id,source_memory_id),
  FOREIGN KEY(user_id,source_memory_id) REFERENCES public.synqme_persona_memories(user_id,id) ON DELETE CASCADE,
  CHECK(manual_status<>'matched' OR (manual_url IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE TABLE public.synqme_evaluation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  evaluation_key text NOT NULL CHECK(length(evaluation_key) BETWEEN 1 AND 180),
  scope_key text NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 180),
  evaluation_kind text NOT NULL CHECK(evaluation_kind IN ('conversation_turn','scenario_self_review','scenario_test')),
  origin text NOT NULL CHECK(origin IN ('runtime_observation','user_self_report','test_runner')),
  outcome text NOT NULL CHECK(outcome IN ('observed','self_reported_complete','passed','failed','needs_review')),
  selected_question_key text CHECK(length(selected_question_key)<=180),
  response_question_key text CHECK(length(response_question_key)<=180),
  response_outcome text CHECK(response_outcome IN ('response_received','deferred')),
  checks jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(checks)='object' AND octet_length(checks::text)<=8192),
  source_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(source_refs)='array' AND jsonb_array_length(source_refs)<=8 AND octet_length(source_refs::text)<=4096),
  engine_version text NOT NULL DEFAULT 'persistence-v1' CHECK(length(engine_version)<=80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,evaluation_key),
  CHECK ((evaluation_kind='conversation_turn' AND origin='runtime_observation' AND outcome='observed')
    OR (evaluation_kind='scenario_self_review' AND origin='user_self_report' AND outcome='self_reported_complete')
    OR (evaluation_kind='scenario_test' AND origin='test_runner' AND outcome IN ('passed','failed','needs_review')))
);
CREATE INDEX synqme_evaluation_scope_created ON public.synqme_evaluation_records(user_id,scope_key,created_at DESC);

-- Every operation remains scoped to the authenticated account, including
-- trigger writes and RPC calls. No service-role credential is needed.
DO $policies$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['synqme_decision_states','synqme_appliance_references','synqme_evaluation_records'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon',tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',tbl);
    EXECUTE format('CREATE POLICY account_owner ON public.%I FOR ALL TO authenticated USING ((select auth.uid())=user_id AND coalesce((select auth.jwt()->>''is_anonymous''),''false'')<>''true'') WITH CHECK ((select auth.uid())=user_id AND coalesce((select auth.jwt()->>''is_anonymous''),''false'')<>''true'')',tbl);
  END LOOP;
END $policies$;

CREATE FUNCTION public.synqme_version_persona_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN NEW.rule_version:=1;
  ELSE
    NEW.rule_version:=OLD.rule_version + CASE WHEN
      ROW(NEW.statement,NEW.kind,NEW.scope_key,NEW.status,NEW.conditions,NEW.permission_policy)
      IS DISTINCT FROM ROW(OLD.statement,OLD.kind,OLD.scope_key,OLD.status,OLD.conditions,OLD.permission_policy)
      THEN 1 ELSE 0 END;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER synqme_version_rule BEFORE INSERT OR UPDATE ON public.synqme_persona_memories
FOR EACH ROW EXECUTE FUNCTION public.synqme_version_persona_rule();

CREATE FUNCTION public.synqme_sync_amia_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE appliance jsonb; verified timestamptz; link text; manual_state text;
BEGIN
  IF NEW.status IN ('archived','superseded') THEN
    DELETE FROM public.synqme_decision_states WHERE user_id=NEW.user_id AND source_memory_id=NEW.id;
    DELETE FROM public.synqme_appliance_references WHERE user_id=NEW.user_id AND source_memory_id=NEW.id;
    RETURN NEW;
  END IF;
  INSERT INTO public.synqme_decision_states(user_id,scope_key,decision_key,topic,source_memory_id,status,source_refs)
    VALUES(NEW.user_id,'topic:'||NEW.topic,'rule:'||NEW.id,NEW.topic,NEW.id,
      CASE NEW.status WHEN 'conflicting' THEN 'conflicting' WHEN 'inferred_pending_confirmation' THEN 'unconfirmed' ELSE 'known' END,NEW.source_refs)
    ON CONFLICT(user_id,source_memory_id) DO UPDATE SET
      scope_key=EXCLUDED.scope_key,topic=EXCLUDED.topic,status=EXCLUDED.status,source_refs=EXCLUDED.source_refs,updated_at=now();
  appliance:=NEW.attributes->'appliance_v1';
  IF NEW.status IN ('inferred_pending_confirmation','conflicting') OR jsonb_typeof(appliance) IS DISTINCT FROM 'object'
    OR coalesce(length(trim(appliance->>'type')),0) NOT BETWEEN 1 AND 80
    OR coalesce(length(trim(appliance->>'brand')),0) NOT BETWEEN 1 AND 80
    OR coalesce(length(trim(appliance->>'model')),0) NOT BETWEEN 1 AND 80 THEN
    DELETE FROM public.synqme_appliance_references WHERE user_id=NEW.user_id AND source_memory_id=NEW.id;
    RETURN NEW;
  END IF;
  link:=appliance->>'manual_url';
  IF link IS NOT NULL AND (length(link)>2048 OR link !~ '^https://[^[:space:]]+$') THEN link:=NULL; END IF;
  BEGIN verified:=NULLIF(appliance->>'verified_at','')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN verified:=NULL;
  END;
  IF verified>now()+interval '5 minutes' THEN verified:=NULL; END IF;
  manual_state:=coalesce(appliance->>'manual_status','unverified');
  IF manual_state NOT IN ('matched','unverified','not_configured','manufacturer_unverified','model_incomplete','search_unavailable','manual_unverified')
    OR (manual_state='matched' AND (verified IS NULL OR link IS NULL)) THEN manual_state:='unverified'; END IF;
  INSERT INTO public.synqme_appliance_references(user_id,source_memory_id,appliance_key,type,brand,model,manual_url,manual_status,verified_at)
    VALUES(NEW.user_id,NEW.id,NEW.memory_key,trim(appliance->>'type'),trim(appliance->>'brand'),trim(appliance->>'model'),link,manual_state,verified)
    ON CONFLICT(user_id,source_memory_id) DO UPDATE SET
      appliance_key=EXCLUDED.appliance_key,type=EXCLUDED.type,brand=EXCLUDED.brand,model=EXCLUDED.model,
      manual_url=EXCLUDED.manual_url,manual_status=EXCLUDED.manual_status,verified_at=EXCLUDED.verified_at,checked_at=now(),updated_at=now();
  RETURN NEW;
END $fn$;
CREATE TRIGGER synqme_sync_amia_rule AFTER INSERT OR UPDATE ON public.synqme_persona_memories
FOR EACH ROW EXECUTE FUNCTION public.synqme_sync_amia_rule();

CREATE FUNCTION public.record_synqme_amia_turn(
  p_turn_key text,p_scope_key text,p_topic text,p_question_key text,p_question text,
  p_response_question_key text,p_response_outcome text,p_source_timestamp timestamptz,p_checks jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE owner_id uuid:=auth.uid(); event_id uuid; refs jsonb;
BEGIN
  IF owner_id IS NULL OR coalesce(auth.jwt()->>'is_anonymous','false')='true' THEN RAISE EXCEPTION 'Registered account required' USING ERRCODE='42501'; END IF;
  IF length(p_turn_key) NOT BETWEEN 1 AND 180 OR length(p_scope_key) NOT BETWEEN 1 AND 180
    OR length(p_topic)>80 OR jsonb_typeof(p_checks) IS DISTINCT FROM 'object'
    OR p_checks - ARRAY['question_count','used_fallback','manual_source_verified','repeated_question'] <> '{}'::jsonb
    OR jsonb_typeof(p_checks->'question_count') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_checks->'used_fallback') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_checks->'manual_source_verified') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_checks->'repeated_question') IS DISTINCT FROM 'boolean'
    OR p_source_timestamp IS NULL OR p_source_timestamp>now()+interval '5 minutes'
    OR p_source_timestamp<'2010-01-01'::timestamptz THEN RAISE EXCEPTION 'Invalid turn metadata' USING ERRCODE='22023'; END IF;
  IF (p_checks->>'question_count')::numeric NOT BETWEEN 0 AND 100
    OR (p_question IS NULL) IS DISTINCT FROM (p_question_key IS NULL)
    OR (p_question IS NOT NULL AND (length(trim(p_question)) NOT BETWEEN 1 AND 600 OR length(p_question_key) NOT BETWEEN 1 AND 180))
    OR (p_response_question_key IS NULL) IS DISTINCT FROM (p_response_outcome IS NULL)
    OR p_response_outcome NOT IN ('response_received','deferred') THEN RAISE EXCEPTION 'Invalid question metadata' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||p_scope_key,0));
  refs:=jsonb_build_array(jsonb_build_object('conversation_key','main','message_timestamp',p_source_timestamp,'role','user'));
  INSERT INTO public.synqme_evaluation_records(user_id,evaluation_key,scope_key,evaluation_kind,origin,outcome,
      selected_question_key,response_question_key,response_outcome,checks,source_refs)
    VALUES(owner_id,p_turn_key,p_scope_key,'conversation_turn','runtime_observation','observed',p_question_key,
      p_response_question_key,p_response_outcome,p_checks,refs)
    ON CONFLICT(user_id,evaluation_key) DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NULL THEN RETURN jsonb_build_object('saved',true,'duplicate',true); END IF;
  IF p_response_question_key IS NOT NULL THEN
    UPDATE public.synqme_decision_states SET status=p_response_outcome,responded_at=p_source_timestamp,updated_at=now(),source_refs=source_refs||refs
      WHERE user_id=owner_id AND scope_key=p_scope_key AND decision_key=p_response_question_key
        AND source_memory_id IS NULL AND status='unanswered' AND last_asked_at<=p_source_timestamp;
  END IF;
  IF p_question IS NOT NULL THEN
    INSERT INTO public.synqme_decision_states(user_id,scope_key,decision_key,topic,question,status,source_refs,last_asked_at,asked_count)
      VALUES(owner_id,p_scope_key,p_question_key,p_topic,p_question,'unanswered',jsonb_build_array(jsonb_build_object('conversation_key','main','role','assistant','turn_key',p_turn_key,'in_reply_to_user_timestamp',p_source_timestamp)),p_source_timestamp,1)
      ON CONFLICT(user_id,scope_key,decision_key) DO UPDATE SET status='unanswered',question=EXCLUDED.question,
        source_refs=EXCLUDED.source_refs,last_asked_at=EXCLUDED.last_asked_at,responded_at=NULL,
        asked_count=public.synqme_decision_states.asked_count+1,updated_at=now()
      WHERE public.synqme_decision_states.source_memory_id IS NULL AND
        (public.synqme_decision_states.last_asked_at IS NULL OR public.synqme_decision_states.last_asked_at<=EXCLUDED.last_asked_at);
  END IF;
  RETURN jsonb_build_object('saved',true,'evaluation_id',event_id);
END $fn$;
REVOKE ALL ON FUNCTION public.record_synqme_amia_turn(text,text,text,text,text,text,text,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_synqme_amia_turn(text,text,text,text,text,text,text,timestamptz,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.synqme_version_persona_rule(),public.synqme_sync_amia_rule() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.synqme_version_persona_rule(),public.synqme_sync_amia_rule() TO authenticated;

-- Preserve legacy provenance where its timestamp is known. Old manual links
-- lacking an actual verification timestamp are imported as unverified.
UPDATE public.synqme_persona_memories SET source_refs=CASE WHEN source_timestamp IS NOT NULL THEN
  jsonb_build_array(jsonb_build_object('conversation_key',source_conversation_key,'message_timestamp',source_timestamp,'role','user')) ELSE '[]'::jsonb END;

COMMENT ON TABLE public.synqme_decision_states IS 'Account-owned known/conflicting rule references and question states. A received response is not automatically a confirmed decision.';
COMMENT ON TABLE public.synqme_appliance_references IS 'Normalized identity and manufacturer manual links. No manual files or extracted manual content. Sources must be revalidated on use.';
COMMENT ON TABLE public.synqme_evaluation_records IS 'Runtime observations, explicitly labelled user self-reviews and test-run results; runtime observations are never scored as passed tests.';
COMMENT ON COLUMN public.synqme_persona_memories.permission_policy IS 'Permission for the scoped action, explicitly stated by the user; unspecified is never permission.';
