alter table public.synqme_usage_events
  drop constraint if exists synqme_usage_events_event_type_check;

alter table public.synqme_usage_events
  add constraint synqme_usage_events_event_type_check
  check (event_type in ('deepseek_chat', 'deepseek_search', 'deepseek_fetch', 'phonic_voice'));
