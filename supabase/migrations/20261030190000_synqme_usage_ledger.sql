create table if not exists public.synqme_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('deepseek_chat', 'phonic_voice')),
  provider text not null,
  model text,
  request_id text,
  provider_conversation_id text,
  status text not null default 'complete' check (status in ('pending', 'complete', 'estimated', 'failed')),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  cache_hit_tokens bigint not null default 0 check (cache_hit_tokens >= 0),
  cache_miss_tokens bigint not null default 0 check (cache_miss_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  search_requests integer not null default 0 check (search_requests >= 0),
  fetch_requests integer not null default 0 check (fetch_requests >= 0),
  voice_duration_ms bigint check (voice_duration_ms is null or voice_duration_ms >= 0),
  user_speech_ms bigint check (user_speech_ms is null or user_speech_ms >= 0),
  assistant_speech_ms bigint check (assistant_speech_ms is null or assistant_speech_ms >= 0),
  deepseek_cost_usd numeric(18,10) not null default 0,
  search_cost_usd numeric(18,10) not null default 0,
  fetch_cost_usd numeric(18,10) not null default 0,
  phonic_cost_usd numeric(18,10),
  phonic_rate_per_minute_usd numeric(12,6),
  currency text not null default 'USD',
  cost_method text not null default 'provider_usage_and_rate_card',
  pricing_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint synqme_usage_events_request_id_unique unique (request_id),
  constraint synqme_usage_events_provider_conversation_unique unique (provider_conversation_id)
);

create index if not exists synqme_usage_events_user_created_idx
  on public.synqme_usage_events (user_id, created_at desc);
create index if not exists synqme_usage_events_created_idx
  on public.synqme_usage_events (created_at desc);
create index if not exists synqme_usage_events_type_status_idx
  on public.synqme_usage_events (event_type, status, created_at desc);

alter table public.synqme_usage_events enable row level security;
revoke all on public.synqme_usage_events from public, anon, authenticated;
grant select, insert, update on public.synqme_usage_events to service_role;
