"use strict";

// All stakes are in minor units (see config.wallet.decimals). Multipliers are integers in
// hundredths: 100 = 1.00x, 213 = 2.13x. Every game targets a 1% house edge (99% RTP).

const crash = {
  configVersion: 1,
  minStake: 10, // 0.10 VC
  maxStake: 100000, // 1,000.00 VC
  houseEdgeBps: 100, // 1%
  maxMultiplierX100: 100000, // 1000.00x cap
  // The multiplier grows as e^(growthPerMs * elapsedMs): 2x after ~11.6s, 10x after ~38s.
  growthPerMs: 0.00006,
};

/**
 * Original payout tables (not copied from any other site). Symmetric: index = bucket = number of
 * rights. Each table's RTP is between 98.6% and 99.0%, checked in test/plinko.rules.test.js.
 */
const plinko = {
  configVersion: 1,
  minStake: 10,
  maxStake: 100000,
  rows: [8, 12, 16],
  risks: ["low", "medium", "high"],
  multipliersX100: {
    8: {
      low: [360, 230, 141, 85, 50, 85, 141, 230, 360],
      medium: [620, 300, 146, 74, 40, 74, 146, 300, 620],
      high: [1260, 430, 151, 54, 20, 54, 151, 430, 1260],
    },
    12: {
      low: [550, 380, 260, 174, 117, 77, 50, 77, 117, 174, 260, 380, 550],
      medium: [1490, 780, 410, 220, 113, 58, 30, 58, 113, 220, 410, 780, 1490],
      high: [3400, 1390, 570, 240, 98, 43, 20, 43, 98, 240, 570, 1390, 3400],
    },
    16: {
      low: [780, 560, 410, 290, 210, 148, 104, 73, 50, 73, 104, 148, 210, 290, 410, 560, 780],
      medium: [2400, 1430, 840, 490, 290, 167, 96, 54, 30, 54, 96, 167, 290, 490, 840, 1430, 2400],
      high: [6100, 3000, 1450, 710, 350, 169, 82, 40, 20, 40, 82, 169, 350, 710, 1450, 3000, 6100],
    },
  },
};

const mines = {
  configVersion: 1,
  minStake: 10,
  maxStake: 100000,
  houseEdgeBps: 100,
  gridSize: 5,
  tileCount: 25,
  minMines: 1,
  maxMines: 24,
  maxMultiplierX100: 100000000, // 1,000,000.00x cap
};

/** Rolls are 0.00 to 99.99 (0..9999 in hundredths). Win chance must be 1.00% to 98.00%. */
const dice = {
  configVersion: 1,
  minStake: 10,
  maxStake: 100000,
  houseEdgeBps: 100,
  rollSpan: 10000,
  minWinCount: 100, // 1.00% -> 99.00x
  maxWinCount: 9800, // 98.00% -> 1.01x
};

// Games whose page is built. The lobby shows any others as "coming soon".
const PLAYABLE = ["crash", "plinko", "mines", "dice"];

function summary(id, name, config, settings) {
  return {
    id,
    name,
    // `available` drives the lobby's "coming soon" state.
    available: PLAYABLE.includes(id),
    minStake: config.minStake,
    maxStake: config.maxStake,
    configVersion: config.configVersion,
    ...(settings ? { settings } : {}),
  };
}

const games = [
  summary("crash", "Crash", crash),
  summary("plinko", "Plinko", plinko, {
    rows: plinko.rows,
    risks: plinko.risks,
    multipliersX100: plinko.multipliersX100,
  }),
  summary("mines", "Mines", mines, {
    gridSize: mines.gridSize,
    tileCount: mines.tileCount,
    minMines: mines.minMines,
    maxMines: mines.maxMines,
  }),
  summary("dice", "Dice", dice, {
    rollSpan: dice.rollSpan,
    minWinCount: dice.minWinCount,
    maxWinCount: dice.maxWinCount,
    houseEdgeBps: dice.houseEdgeBps,
  }),
];

module.exports = { crash, plinko, mines, dice, games };
