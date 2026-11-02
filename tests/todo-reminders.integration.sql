begin;
insert into auth.users(id,email) values ('7d333333-3333-4333-8333-333333333333','todo-owner@example.invalid'),('7d444444-4444-4444-8444-444444444444','todo-other@example.invalid');
insert into public.synqme_reminders(user_id,title) values ('7d444444-4444-4444-8444-444444444444','Other owner fixture');
set local role authenticated;
select set_config('request.jwt.claim.sub','7d333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claims','{"sub":"7d333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',true);
insert into public.synqme_reminders(user_id,title) values (auth.uid(),'Find dishwasher model');
do $$ declare affected integer; begin
 if (select count(*) from public.synqme_reminders)<>1 then raise exception 'Owner cannot read own reminder or can read another account'; end if;
 update public.synqme_reminders set title='Find full model number',completed=true where user_id=auth.uid();
 if not exists(select 1 from public.synqme_reminders where completed and title='Find full model number') then raise exception 'Update failed'; end if;
 update public.synqme_reminders set title='Cross account edit' where user_id='7d444444-4444-4444-8444-444444444444'; get diagnostics affected=row_count;
 if affected<>0 then raise exception 'Cross account update allowed'; end if;
 begin
  insert into public.synqme_reminders(user_id,title) values ('7d444444-4444-4444-8444-444444444444','Unauthorized fixture');
  raise exception 'Cross account insert allowed';
 exception when insufficient_privilege then null; end;
 delete from public.synqme_reminders where user_id=auth.uid();
 if exists(select 1 from public.synqme_reminders) then raise exception 'Delete failed'; end if;
end $$;
reset role;
rollback;
