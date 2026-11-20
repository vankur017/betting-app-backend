"use strict";

const { randomInt } = require("node:crypto");
const { binomial } = require("../shared/math");

/**
 * Plinko: the ball falls through `rows` rows of pegs and goes left (0) or right (1) at each one,
 * using a CSPRNG. The bucket is the number of rights (0..rows), so buckets follow a binomial
 * distribution and the edges are the rarest.
 */
function generatePath(rows, randomIntFn = randomInt) {
  return Array.from({ length: rows }, () => randomIntFn(0, 2));
}

function bucketForPath(path) {
  return path.reduce((sum, step) => sum + step, 0);
}

function isValidPath(path, rows) {
  return Array.isArray(path) && path.length === rows && path.every((step) => step === 0 || step === 1);
}

/** Multiplier table (hundredths) for one board setting, or undefined if it is not supported. */
function multiplierTable(config, rows, risk) {
  return config.multipliersX100[rows]?.[risk];
}

/** Expected return per 1.00 staked, in hundredths: 99 means 99% RTP. Weights are exact BigInt. */
function expectedReturnX100(table) {
  const rows = table.length - 1;
  const total = table.reduce((sum, m, k) => sum + binomial(rows, k) * BigInt(m), 0n);
  return Number(total) / 2 ** rows;
}

module.exports = { generatePath, bucketForPath, isValidPath, multiplierTable, expectedReturnX100 };
