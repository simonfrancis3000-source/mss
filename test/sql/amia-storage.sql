-- Run with a database administrator. All fixtures and writes roll back.
BEGIN;
SELECT set_config('amia.owner_a',gen_random_uuid()::text,true),set_config('amia.owner_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,aud,role,email)
  SELECT current_setting('amia.owner_a')::uuid,'authenticated','authenticated','amia-a-'||current_setting('amia.owner_a')||'@example.invalid'
  UNION ALL SELECT current_setting('amia.owner_b')::uuid,'authenticated','authenticated','amia-b-'||current_setting('amia.owner_b')||'@example.invalid';
INSERT INTO public.synqme_persona_memories(user_id,memory_key,kind,statement,permission_policy)
  VALUES(current_setting('amia.owner_a')::uuid,'amia-test-rule-a','boundary','Ask me before ordering replacement supplies.','ask_first'),
    (current_setting('amia.owner_b')::uuid,'amia-test-rule-b','preference','I prefer the dishwasher in the evening.','unspecified');
SELECT set_config('amia.rule_a',(SELECT id::text FROM public.synqme_persona_memories WHERE memory_key='amia-test-rule-a' AND user_id=current_setting('amia.owner_a')::uuid),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amia.owner_a'),'role','authenticated','is_anonymous',false)::text,true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.synqme_persona_memories WHERE memory_key IN ('amia-test-rule-a','amia-test-rule-b'))<>1 THEN RAISE EXCEPTION 'Rule ownership failed'; END IF;
  IF (SELECT count(*) FROM public.synqme_decision_states WHERE source_memory_id=current_setting('amia.rule_a')::uuid AND status='known')<>1 THEN RAISE EXCEPTION 'Known rule synchronization failed'; END IF;
  BEGIN
    INSERT INTO public.synqme_evaluation_records(user_id,evaluation_key,scope_key,evaluation_kind,origin,outcome)
      VALUES(current_setting('amia.owner_b')::uuid,'cross-owner','room:kitchen','conversation_turn','runtime_observation','observed');
    RAISE EXCEPTION 'Cross-owner insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.synqme_persona_memories(user_id,memory_key,kind,statement,status,permission_policy)
      VALUES(current_setting('amia.owner_a')::uuid,'inferred-permission','boundary','I may order replacements when needed.','inferred_pending_confirmation','allowed');
    RAISE EXCEPTION 'Inferred permission was allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.synqme_persona_memories SET supersedes_id=current_setting('amia.rule_a')::uuid,user_id=current_setting('amia.owner_b')::uuid WHERE id=current_setting('amia.rule_a')::uuid;
    RAISE EXCEPTION 'Ownership reassignment was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.synqme_persona_memories SET statement='Always ask me before ordering replacement supplies.' WHERE id=current_setting('amia.rule_a')::uuid;
  IF (SELECT rule_version FROM public.synqme_persona_memories WHERE id=current_setting('amia.rule_a')::uuid)<>2 THEN RAISE EXCEPTION 'Rule version did not increment'; END IF;
  UPDATE public.synqme_persona_memories SET status='conflicting' WHERE id=current_setting('amia.rule_a')::uuid;
  IF (SELECT status FROM public.synqme_decision_states WHERE source_memory_id=current_setting('amia.rule_a')::uuid)<>'conflicting' THEN RAISE EXCEPTION 'Conflict synchronization failed'; END IF;
END $test$;

INSERT INTO public.synqme_persona_memories(user_id,memory_key,kind,statement,attributes)
VALUES(current_setting('amia.owner_a')::uuid,'amia-test-device','fact','My test dishwasher is Bosch model ABC1234/01.',
  jsonb_build_object('appliance_v1',jsonb_build_object('type','dishwasher','brand','Bosch','model','ABC1234/01','manual_url','https://bosch-home.com/manual','manual_status','matched','verified_at',now())));
DO $test$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.synqme_appliance_references WHERE appliance_key='amia-test-device' AND model='ABC1234/01' AND manual_status='matched' AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Appliance link was not normalized'; END IF;
  UPDATE public.synqme_persona_memories SET attributes=jsonb_set(attributes,'{appliance_v1,verified_at}','null') WHERE memory_key='amia-test-device';
  IF (SELECT manual_status FROM public.synqme_appliance_references WHERE appliance_key='amia-test-device')<>'unverified' THEN RAISE EXCEPTION 'Legacy verification was incorrectly trusted'; END IF;
END $test$;

SELECT public.record_synqme_amia_turn('fixture-turn-one','room:kitchen','kitchen','q:fixture','What should I wash by hand?',null,null,now()-interval '1 second',
  '{"question_count":1,"used_fallback":false,"manual_source_verified":false,"repeated_question":false}');
SELECT public.record_synqme_amia_turn('fixture-turn-two','room:kitchen','kitchen',null,null,'q:fixture','deferred',now(),
  '{"question_count":0,"used_fallback":false,"manual_source_verified":false,"repeated_question":false}');
SELECT public.record_synqme_amia_turn('fixture-turn-two','room:kitchen','kitchen','q:duplicate','Duplicate retry?',null,null,now(),
  '{"question_count":1,"used_fallback":false,"manual_source_verified":false,"repeated_question":false}');
DO $test$
BEGIN
  IF (SELECT status FROM public.synqme_decision_states WHERE decision_key='q:fixture')<>'deferred' THEN RAISE EXCEPTION 'Deferral not saved'; END IF;
  IF (SELECT count(*) FROM public.synqme_decision_states WHERE decision_key='q:duplicate')<>0 THEN RAISE EXCEPTION 'Duplicate turn mutated state'; END IF;
  IF (SELECT count(*) FROM public.synqme_evaluation_records WHERE evaluation_key IN ('fixture-turn-one','fixture-turn-two'))<>2 THEN RAISE EXCEPTION 'Idempotent evaluation count failed'; END IF;
  BEGIN
    INSERT INTO public.synqme_evaluation_records(user_id,evaluation_key,scope_key,evaluation_kind,origin,outcome)
      VALUES(current_setting('amia.owner_a')::uuid,'fake-pass','room:kitchen','conversation_turn','runtime_observation','passed');
    RAISE EXCEPTION 'Runtime was allowed to claim a passed test';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amia.owner_b'),'role','authenticated','is_anonymous',false)::text,true);
DO $test$
BEGIN
  IF EXISTS(SELECT 1 FROM public.synqme_appliance_references WHERE appliance_key='amia-test-device') OR EXISTS(SELECT 1 FROM public.synqme_evaluation_records WHERE evaluation_key='fixture-turn-one') THEN RAISE EXCEPTION 'Cross-account read allowed'; END IF;
  BEGIN
    INSERT INTO public.synqme_appliance_references(user_id,source_memory_id,appliance_key,type,brand,model)
      VALUES(current_setting('amia.owner_b')::uuid,current_setting('amia.rule_a')::uuid,'cross-reference','dishwasher','Bosch','ABC1234/01');
    RAISE EXCEPTION 'Cross-account source reference allowed';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amia.owner_a'),'role','authenticated','is_anonymous',true)::text,true);
DO $test$ BEGIN
  IF EXISTS(SELECT 1 FROM public.synqme_decision_states) THEN RAISE EXCEPTION 'Anonymous account read allowed'; END IF;
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amia.owner_a'),'role','authenticated','is_anonymous',false)::text,true);
DELETE FROM public.synqme_persona_memories WHERE memory_key='amia-test-device';
DO $test$ BEGIN
  IF EXISTS(SELECT 1 FROM public.synqme_appliance_references WHERE appliance_key='amia-test-device') THEN RAISE EXCEPTION 'Forgotten device remained'; END IF;
END $test$;
RESET ROLE;
ROLLBACK;
SELECT 'passed: rule versions, permissions, conflicts, appliance provenance, idempotency, deferrals, evaluation origins, RLS isolation, cross-owner foreign keys and forgetting; all fixtures rolled back' AS verification;
