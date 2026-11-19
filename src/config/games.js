"use strict";

// All stakes are in minor units (see config.wallet.decimals). Multipliers are integers in
// hundredths: 100 = 1.00x, 213 = 2.13x.

const crash = {
  configVersion: 1,
  minStake: 10, // 0.10 VC
  maxStake: 100000, // 1,000.00 VC
  houseEdgeBps: 100, // 1%
  maxMultiplierX100: 100000, // 1000.00x cap
  // The multiplier grows as e^(growthPerMs * elapsedMs): 2x after ~11.6s, 10x after ~38s.
  growthPerMs: 0.00006,
};

const games = [
  { id: "crash", name: "Crash", available: true, minStake: crash.minStake, maxStake: crash.maxStake, configVersion: crash.configVersion },
  { id: "plinko", name: "Plinko", available: false },
  { id: "mines", name: "Mines", available: false },
  { id: "dice", name: "Dice", available: false },
];

module.exports = { crash, games };
