export function cognitiveRollout({ enabled = false, allAccounts = false, userIds = '', emails = '' } = {}) {
  const ids=new Set(String(userIds).split(',').map(s=>s.trim()).filter(Boolean));
  const addresses=new Set(String(emails).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
  return user => enabled && Boolean(user?.id) && user.is_anonymous !== true && (allAccounts === true || ids.has(user.id) || addresses.has(String(user.email || '').toLowerCase()));
}
