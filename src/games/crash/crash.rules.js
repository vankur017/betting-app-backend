"use strict";

const { randomInt } = require("node:crypto");

// crypto.randomInt requires (max - min) < 2^48.
const RANDOM_SPAN = 2 ** 48 - 1;

/**
 * Generates the crash point in hundredths, using a CSPRNG.
 *
 * u = n / RANDOM_SPAN is uniform in [0, 1). crash = (1 - houseEdge) / (1 - u), floored to 0.01x
 * and clamped to [1.00x, max]. So P(crash >= m) = (1 - houseEdge) / m for every m >= 1.00x,
 * and about houseEdge of rounds crash immediately at 1.00x.
 * BigInt keeps the calculation exact.
 */
function generateCrashPointX100({ houseEdgeBps, maxMultiplierX100 }, randomIntFn = randomInt) {
  const span = BigInt(RANDOM_SPAN);
  const n = BigInt(randomIntFn(0, RANDOM_SPAN));
  const raw = (BigInt(10000 - houseEdgeBps) * span) / (100n * (span - n));
  if (raw < 100n) return 100;
  if (raw > BigInt(maxMultiplierX100)) return maxMultiplierX100;
  return Number(raw);
}

/** Multiplier (hundredths) after elapsedMs of a running round, floored to 0.01x. */
function multiplierAtX100(elapsedMs, { growthPerMs, maxMultiplierX100 }) {
  if (elapsedMs <= 0) return 100;
  const value = Math.floor(100 * Math.exp(growthPerMs * elapsedMs));
  return Math.min(Math.max(value, 100), maxMultiplierX100);
}

/**
 * Smallest whole millisecond at which the multiplier reaches the crash point.
 * A round is crashed at or after this time; a cash-out is valid only before it.
 */
function crashDurationMs(crashX100, config) {
  let t = Math.max(0, Math.ceil(Math.log(crashX100 / 100) / config.growthPerMs));
  while (t > 0 && multiplierAtX100(t - 1, config) >= crashX100) t -= 1;
  while (multiplierAtX100(t, config) < crashX100) t += 1;
  return t;
}

/** Virtual return in minor units: stake x multiplier, rounded down. Exact integer math. */
function payoutFor(stake, multiplierX100) {
  const product = stake * multiplierX100;
  return (product - (product % 100)) / 100;
}

function formatMultiplier(x100) {
  return `${Math.floor(x100 / 100)}.${String(x100 % 100).padStart(2, "0")}x`;
}

module.exports = {
  RANDOM_SPAN,
  generateCrashPointX100,
  multiplierAtX100,
  crashDurationMs,
  payoutFor,
  formatMultiplier,
};
