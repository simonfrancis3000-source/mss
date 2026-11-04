export function cognitiveRollout({ enabled = false, userIds = '', emails = '' } = {}) {
  const ids=new Set(String(userIds).split(',').map(s=>s.trim()).filter(Boolean));
  const addresses=new Set(String(emails).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
  return user => enabled && Boolean(user?.id) && (!ids.size&&!addresses.size || ids.has(user.id) || addresses.has(String(user.email || '').toLowerCase()));
}
