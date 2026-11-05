-- Google Play can report a pending subscription before any payment clears.
-- Record its verified inactive state without granting Chat or Talk.
alter table public.mss_subscription_entitlements
 drop constraint if exists mss_subscription_entitlements_status_check;
alter table public.mss_subscription_entitlements
 add constraint mss_subscription_entitlements_status_check
 check (status in ('active','canceled','grace','hold','expired','revoked','test','pending'));
