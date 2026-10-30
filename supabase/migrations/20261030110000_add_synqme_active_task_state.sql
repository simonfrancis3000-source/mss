alter table public.synqme_room_journeys
  add column if not exists active_task_id text;

comment on column public.synqme_room_journeys.active_task_id is
  'The account holder selected task within active_room_id. Cleared when the task is completed or the active room changes.';
