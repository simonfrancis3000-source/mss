// Discount policy for a future partner checkout integration.
// The checkout API must re-check the server-issued rewards balance, training
// eligibility, purchase limits and manufacturer offer before committing a code.
export function calculateRobotRewardDiscount({
  availableCreditCents,
  eligibleHardwarePriceCents,
  partnerOfferLimitCents = null
} = {}) {
  for (const [name, value] of Object.entries({ availableCreditCents, eligibleHardwarePriceCents })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name + ' must be non-negative integer cents');
  }
  if (partnerOfferLimitCents !== null && (!Number.isSafeInteger(partnerOfferLimitCents) || partnerOfferLimitCents < 0)) {
    throw new TypeError('partnerOfferLimitCents must be non-negative integer cents or null');
  }
  // Divide cents by twenty, rounding down, to cap a discount at exactly 5%.
  const fivePercentCents = Math.floor(eligibleHardwarePriceCents / 20);
  const permitted = partnerOfferLimitCents === null ? fivePercentCents : Math.min(fivePercentCents, partnerOfferLimitCents);
  const discountCents = Math.min(availableCreditCents, permitted);
  return {
    discountCents,
    remainingCreditCents: availableCreditCents - discountCents,
    fivePercentCents
  };
}
