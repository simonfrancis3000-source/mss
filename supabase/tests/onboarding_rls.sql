-- Rollback-only integration check. Run as a database administrator.
begin;
do $test$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  touched integer;
begin
  insert into auth.users (id, email) values
    (owner_id, 'onboarding-rls-' || owner_id || '@example.invalid'),
    (other_id, 'onboarding-rls-' || other_id || '@example.invalid');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  insert into public.synqme_onboarding(user_id) values(owner_id);
  update public.synqme_onboarding set version=1,outcome='skipped',dismissed_at=now() where user_id=owner_id;
  if not exists (select 1 from public.synqme_onboarding where user_id=owner_id and outcome='skipped') then raise exception 'Owner cannot read/update own record'; end if;
  begin
    insert into public.synqme_onboarding(user_id) values(other_id);
    raise exception 'Cross-account insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.synqme_onboarding set user_id=other_id where user_id=owner_id;
    raise exception 'Record reassignment unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  set local role authenticated;
  if exists (select 1 from public.synqme_onboarding where user_id=owner_id) then raise exception 'Cross-account read unexpectedly allowed'; end if;
  update public.synqme_onboarding set version=2 where user_id=owner_id;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'Cross-account update unexpectedly allowed'; end if;
  reset role;
  set local role anon;
  begin
    perform 1 from public.synqme_onboarding;
    raise exception 'Anonymous read unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;
end
$test$;
rollback;
select 'Onboarding owner access, account isolation and anonymous denial passed; test users rolled back.' as result;
