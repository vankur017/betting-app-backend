"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../src/games/crash/crash.rules");
const { crash: config } = require("../src/config/games");

test("crash point is 1.00x at the lowest random value and capped at the highest", () => {
  assert.equal(rules.generateCrashPointX100(config, () => 0), 100);
  assert.equal(rules.generateCrashPointX100(config, () => rules.RANDOM_SPAN - 1), config.maxMultiplierX100);
});

test("crash points follow P(crash >= m) = 0.99 / m", () => {
  const samples = 20000;
  let atLeast2x = 0;
  for (let i = 0; i < samples; i += 1) {
    const x100 = rules.generateCrashPointX100(config);
    assert.ok(Number.isInteger(x100) && x100 >= 100 && x100 <= config.maxMultiplierX100);
    if (x100 >= 200) atLeast2x += 1;
  }
  const share = atLeast2x / samples;
  assert.ok(Math.abs(share - 0.495) < 0.03, `share >= 2x was ${share}`);
});

test("multiplier grows exponentially from 1.00x and floors to 0.01x", () => {
  assert.equal(rules.multiplierAtX100(0, config), 100);
  assert.equal(rules.multiplierAtX100(-50, config), 100);
  assert.equal(rules.multiplierAtX100(5000, config), 134);
  assert.equal(rules.multiplierAtX100(11552, config), 199);
  assert.equal(rules.multiplierAtX100(11553, config), 200);
  assert.equal(rules.multiplierAtX100(10_000_000, config), config.maxMultiplierX100);
});

test("crash duration is the first millisecond the multiplier reaches the crash point", () => {
  for (const crashX100 of [100, 101, 150, 200, 1000, 100000]) {
    const t = rules.crashDurationMs(crashX100, config);
    assert.ok(rules.multiplierAtX100(t, config) >= crashX100, `at ${t}ms for ${crashX100}`);
    if (t > 0) assert.ok(rules.multiplierAtX100(t - 1, config) < crashX100, `before ${t}ms for ${crashX100}`);
  }
  assert.equal(rules.crashDurationMs(100, config), 0);
  assert.equal(rules.crashDurationMs(200, config), 11553);
});

test("payout is stake x multiplier rounded down, in integers", () => {
  assert.equal(rules.payoutFor(150, 213), 319);
  assert.equal(rules.payoutFor(1000, 134), 1340);
  assert.equal(rules.payoutFor(10, 100), 10);
  assert.equal(rules.payoutFor(100000, 100000), 100000000);
});

test("multipliers format with two decimals", () => {
  assert.equal(rules.formatMultiplier(100), "1.00x");
  assert.equal(rules.formatMultiplier(213), "2.13x");
  assert.equal(rules.formatMultiplier(100000), "1000.00x");
});
