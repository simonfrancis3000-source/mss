// Check the operative preference dimension, not every historical mention of a
// value in reasons or authority boundaries. Conflicting old defaults still fail.
export function containsPreferenceValue(text, value) {
  const forms = value.toLowerCase() === 'shelf' ? ['shelf','shelves'] : [value.toLowerCase()];
  return forms.some(form => String(text).toLowerCase().includes(form));
}
export function checkPreferenceCorrection(rules, preferenceScopes, {oldValue, newValue}) {
  const operative = rules.filter(r => preferenceScopes.has(r.scope_key));
  const has = (r, value) => containsPreferenceValue(r.statement,value);
  return {
    correctionPresent: operative.some(r => has(r,newValue) && r.status !== 'conflicting'),
    stalePreferenceActive: operative.some(r => has(r,oldValue) && !has(r,newValue))
  };
}
