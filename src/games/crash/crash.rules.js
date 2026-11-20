"use strict";

const { randomInt } = require("node:crypto");
const { payoutFor, formatMultiplier } = require("../shared/math");

// crypto.randomInt requires (max - min) < 2^48.
const RANDOM_SPAN = 2 ** 48 - 1;

/**
 * Generates the crash point in hundredths, using a CSPRNG.
 *
 * u = n / RANDOM_SPAN is uniform in [0, 1). crash = (1 - houseEdge) / (1 - u), floored to 0.01x
 * and clamped to [1.00x, max]. So P(crash >= m) = (1 - houseEdge) / m for every m >= 1.01x.
 * About 2 x houseEdge of rounds end at 1.00x: values below 1.00x are raised to it, and values in
 * [1.00x, 1.01x) floor to it. A cash-out must land strictly before the crash point.
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

module.exports = {
  RANDOM_SPAN,
  generateCrashPointX100,
  multiplierAtX100,
  crashDurationMs,
  payoutFor,
  formatMultiplier,
};
