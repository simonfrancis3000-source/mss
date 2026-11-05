-- Native Android SmartThings return route is set server-side by a trusted enum,
-- bound to the already random, one-time OAuth state.
alter table public.mss_smartthings_oauth_states
  add column if not exists return_client text not null default 'web'
    check (return_client in ('web','android'));
