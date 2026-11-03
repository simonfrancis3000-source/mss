// Clients opt in to the verified relay; account eligibility stays server controlled.
export function shouldMeterVoice({globallyEnabled=false,accountEligible=false,client=''}) {
 return globallyEnabled || (accountEligible && ['android-1.7','web-profile-balance-v1'].includes(client));
}
