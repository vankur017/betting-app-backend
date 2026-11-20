"use strict";

const { randomInt } = require("node:crypto");
const { binomial } = require("../shared/math");

/**
 * Mines: `mineCount` mines are hidden among `tileCount` tiles (a Fisher-Yates shuffle with a
 * CSPRNG). After k safe reveals the fair multiplier is C(N, k) / C(N - m, k), the inverse of the
 * chance of surviving k picks. The paid multiplier applies the house edge, floors to 0.01x and
 * is capped.
 */
function generateMinePositions(tileCount, mineCount, randomIntFn = randomInt) {
  const tiles = Array.from({ length: tileCount }, (_, i) => i);
  for (let i = tileCount - 1; i > 0; i -= 1) {
    const j = randomIntFn(0, i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, mineCount).sort((a, b) => a - b);
}

function isValidMinePositions(positions, tileCount, mineCount) {
  return (
    Array.isArray(positions) &&
    positions.length === mineCount &&
    new Set(positions).size === mineCount &&
    positions.every((p) => Number.isInteger(p) && p >= 0 && p < tileCount)
  );
}

/** Multiplier in hundredths after `safeReveals` safe tiles. 1.00x before the first reveal. */
function multiplierX100(safeReveals, mineCount, { tileCount, houseEdgeBps, maxMultiplierX100 }) {
  if (safeReveals <= 0) return 100;
  const numerator = BigInt(10000 - houseEdgeBps) * binomial(tileCount, safeReveals);
  const denominator = 100n * binomial(tileCount - mineCount, safeReveals);
  const raw = numerator / denominator;
  return raw > BigInt(maxMultiplierX100) ? maxMultiplierX100 : Number(raw);
}

module.exports = { generateMinePositions, isValidMinePositions, multiplierX100 };
