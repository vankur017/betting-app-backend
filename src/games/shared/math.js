"use strict";

/**
 * Money and multiplier helpers shared by every game.
 * Amounts are integers in minor units; multipliers are integers in hundredths (100 = 1.00x).
 */

/** Virtual return in minor units: stake x multiplier, rounded down. Exact integer math. */
function payoutFor(stake, multiplierX100) {
  const product = stake * multiplierX100;
  return (product - (product % 100)) / 100;
}

function formatMultiplier(x100) {
  return `${Math.floor(x100 / 100)}.${String(x100 % 100).padStart(2, "0")}x`;
}

/** Binomial coefficient C(n, k) as a BigInt, so large values stay exact. */
function binomial(n, k) {
  if (k < 0 || k > n) return 0n;
  const kk = Math.min(k, n - k);
  let result = 1n;
  for (let i = 1; i <= kk; i += 1) {
    result = (result * BigInt(n - kk + i)) / BigInt(i);
  }
  return result;
}

module.exports = { payoutFor, formatMultiplier, binomial };
