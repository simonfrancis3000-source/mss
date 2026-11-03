-- Verified robot purchase rewards. Read/write only by trusted server service role.
-- Never derive promotional money from the separately metered voice-minute wallet.
create table if not exists public.mss_robot_reward_orders (
  order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  paid_usd_cents integer not null default 0 check (paid_usd_cents >= 0),
  currency_code text not null default 'unknown',
  status text not null check (status in ('eligible','excluded','test','pending','pending_currency','refunded')),
  purchased_at timestamptz not null,
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mss_robot_reward_orders_user_purchased
  on public.mss_robot_reward_orders(user_id,purchased_at);
alter table public.mss_robot_reward_orders enable row level security;
revoke all on table public.mss_robot_reward_orders from public, anon, authenticated;
grant select, insert, update, delete on public.mss_robot_reward_orders to service_role;
comment on table public.mss_robot_reward_orders is 'Google Play order facts for the MSS robot rewards program; sourced by service-role authenticated Orders API lookups. No end-user direct table grants.';
