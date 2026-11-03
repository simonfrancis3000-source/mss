import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRobotRewardDiscount } from '../server/robot-rewards-redemption.js';

test('$900 earned on a $5000 robot redeems only $250, leaving $650 unused', () => {
  assert.deepEqual(calculateRobotRewardDiscount({
    availableCreditCents: 90000, eligibleHardwarePriceCents: 500000
  }), { discountCents: 25000, remainingCreditCents: 65000, fivePercentCents: 25000 });
});
test('discount never exceeds earned credit or partner-specific offer limit', () => {
  assert.equal(calculateRobotRewardDiscount({
    availableCreditCents: 5000, eligibleHardwarePriceCents: 1000000
  }).discountCents, 5000);
  assert.equal(calculateRobotRewardDiscount({
    availableCreditCents: 90000, eligibleHardwarePriceCents: 1000000, partnerOfferLimitCents: 30000
  }).discountCents, 30000);
});
test('zero amounts and fractional inputs cannot produce excess discounts', () => {
  assert.equal(calculateRobotRewardDiscount({
    availableCreditCents: 80000, eligibleHardwarePriceCents: 0
  }).discountCents, 0);
  assert.equal(calculateRobotRewardDiscount({
    availableCreditCents: 0, eligibleHardwarePriceCents: 500000
  }).discountCents, 0);
  assert.throws(() => calculateRobotRewardDiscount({
    availableCreditCents: 90000.01, eligibleHardwarePriceCents: 500000
  }), /non-negative integer cents/);
  assert.throws(() => calculateRobotRewardDiscount({
    availableCreditCents: 90000, eligibleHardwarePriceCents: 500000, partnerOfferLimitCents: -1
  }), /non-negative integer cents/);
});
test('UI explains the price cap and included consumer protections', async () => {
  const { readFile } = await import('node:fs/promises');
  const js = await readFile(new URL('../src/mss-interface.js', import.meta.url),'utf8');
  assert.match(js,/5% of the eligible robot hardware price/);
  assert.match(js, /\$900 earned credit on a \$5,000 robot = \$250 off/);
  assert.match(js,/Only the amount actually deducted from the robot purchase uses the rewards balance/);
  assert.match(js,/Nothing in these rules limits mandatory consumer rights/);
});
