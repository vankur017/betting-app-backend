"use strict";

const { randomInt } = require("node:crypto");

/**
 * Dice: the server rolls a number from 0.00 to 99.99 (an integer 0..rollSpan-1 in hundredths)
 * with a CSPRNG. The player wins on "under" when roll < target, or on "over" when roll > target.
 * Multiplier = (1 - houseEdge) / winChance, floored to 0.01x.
 */
const DIRECTIONS = ["under", "over"];

function generateRollX100({ rollSpan }, randomIntFn = randomInt) {
  return randomIntFn(0, rollSpan);
}

/** Number of winning rolls out of rollSpan for this target and direction. */
function winCount(targetX100, direction, { rollSpan }) {
  return direction === "under" ? targetX100 : rollSpan - 1 - targetX100;
}

function isWin(rollX100, targetX100, direction) {
  return direction === "under" ? rollX100 < targetX100 : rollX100 > targetX100;
}

/** Multiplier in hundredths: floor((10000 - houseEdgeBps) x 100 / winCount). */
function multiplierX100(wins, { houseEdgeBps }) {
  return Math.floor(((10000 - houseEdgeBps) * 100) / wins);
}

/** Allowed target range (inclusive) for a direction, from the win-count limits. */
function targetRange(direction, { rollSpan, minWinCount, maxWinCount }) {
  if (direction === "under") return { minTarget: minWinCount, maxTarget: maxWinCount };
  return { minTarget: rollSpan - 1 - maxWinCount, maxTarget: rollSpan - 1 - minWinCount };
}

function formatRoll(x100) {
  return `${Math.floor(x100 / 100)}.${String(x100 % 100).padStart(2, "0")}`;
}

module.exports = { DIRECTIONS, generateRollX100, winCount, isWin, multiplierX100, targetRange, formatRoll };
