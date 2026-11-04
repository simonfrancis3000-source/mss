// Grant exactly one 60-minute complimentary beta allocation per eligible MySecondSelf account.
// The database RPC is atomic and idempotent; never store tester email addresses in the repository.
export function betaTesterEmailSet(value) {
  return new Set(String(value || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
}
export function betaTesterIsEligible(user, allowlist) {
  return Boolean(user?.id && allowlist?.has(String(user.email || "").trim().toLowerCase()));
}
export async function ensureBetaVoiceAllowance({ db, user, allowlist }) {
  if (!betaTesterIsEligible(user, allowlist)) return false;
  if (!db) throw new Error("Voice beta allowance database is unavailable.");
  const { data, error } = await db.rpc("mss_grant_beta_voice_allowance", { p_user_id: user.id });
  if (error) throw new Error("Could not provision beta voice allowance.");
  return data === true;
}
