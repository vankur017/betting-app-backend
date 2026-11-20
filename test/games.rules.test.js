"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const plinko = require("../src/games/plinko/plinko.rules");
const dice = require("../src/games/dice/dice.rules");
const mines = require("../src/games/mines/mines.rules");
const { binomial, payoutFor, formatMultiplier } = require("../src/games/shared/math");
const config = require("../src/config/games");

test("shared math: binomial, payout and formatting", () => {
  assert.equal(binomial(25, 0), 1n);
  assert.equal(binomial(25, 2), 300n);
  assert.equal(binomial(25, 13), 5200300n);
  assert.equal(binomial(5, 6), 0n);
  assert.equal(payoutFor(1000, 198), 1980);
  assert.equal(payoutFor(15, 103), 15); // 15.45 floored
  assert.equal(formatMultiplier(2475), "24.75x");
});

// ---- Plinko ----

test("plinko tables are symmetric, cover every bucket and stay at 98.5-99.0% RTP", () => {
  for (const rows of config.plinko.rows) {
    for (const risk of config.plinko.risks) {
      const table = plinko.multiplierTable(config.plinko, rows, risk);
      assert.equal(table.length, rows + 1, `${rows}/${risk} length`);
      assert.deepEqual([...table].reverse(), table, `${rows}/${risk} symmetric`);
      assert.ok(table.every((m) => Number.isInteger(m) && m > 0), `${rows}/${risk} positive integers`);
      const rtp = plinko.expectedReturnX100(table);
      assert.ok(rtp >= 98.5 && rtp <= 99, `${rows}/${risk} RTP was ${rtp}`);
    }
  }
});

test("plinko path is 0/1 steps and the bucket is the number of rights", () => {
  const path = plinko.generatePath(16);
  assert.ok(plinko.isValidPath(path, 16));
  assert.equal(plinko.bucketForPath([1, 0, 1, 1, 0, 0, 0, 1]), 4);
  assert.equal(plinko.isValidPath([1, 2], 2), false);
  assert.equal(plinko.isValidPath([1], 2), false);
});

// ---- Dice ----

test("dice multiplier is 0.99 / win chance, floored to 0.01x", () => {
  assert.equal(dice.multiplierX100(5000, config.dice), 198);
  assert.equal(dice.multiplierX100(100, config.dice), 9900);
  assert.equal(dice.multiplierX100(9800, config.dice), 101);
});

test("dice win checks and win counts for under and over", () => {
  assert.equal(dice.winCount(5000, "under", config.dice), 5000);
  assert.equal(dice.winCount(4999, "over", config.dice), 5000);
  assert.equal(dice.isWin(4999, 5000, "under"), true);
  assert.equal(dice.isWin(5000, 5000, "under"), false);
  assert.equal(dice.isWin(5000, 4999, "over"), true);
  assert.equal(dice.isWin(4999, 4999, "over"), false);
  assert.deepEqual(dice.targetRange("under", config.dice), { minTarget: 100, maxTarget: 9800 });
  assert.deepEqual(dice.targetRange("over", config.dice), { minTarget: 199, maxTarget: 9899 });
  assert.equal(dice.formatRoll(507), "5.07");
});

test("dice rolls stay in 0..9999", () => {
  for (let i = 0; i < 2000; i += 1) {
    const roll = dice.generateRollX100(config.dice);
    assert.ok(Number.isInteger(roll) && roll >= 0 && roll < 10000);
  }
});

// ---- Mines ----

test("mines multiplier follows C(N,k) / C(N-m,k) with a 1% edge, floored and capped", () => {
  const c = config.mines;
  assert.equal(mines.multiplierX100(0, 3, c), 100);
  assert.equal(mines.multiplierX100(1, 1, c), 103);
  assert.equal(mines.multiplierX100(1, 3, c), 112);
  assert.equal(mines.multiplierX100(2, 3, c), 128);
  assert.equal(mines.multiplierX100(1, 24, c), 2475);
  assert.equal(mines.multiplierX100(24, 1, c), 2475);
  assert.equal(mines.multiplierX100(22, 3, c), 227700);
  assert.equal(mines.multiplierX100(13, 12, c), c.maxMultiplierX100);
});

test("mine positions are unique, sorted and in range", () => {
  for (let i = 0; i < 200; i += 1) {
    const positions = mines.generateMinePositions(25, 5);
    assert.ok(mines.isValidMinePositions(positions, 25, 5));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  }
  assert.equal(mines.isValidMinePositions([1, 1, 2], 25, 3), false);
  assert.equal(mines.isValidMinePositions([0, 25], 25, 2), false);
});
