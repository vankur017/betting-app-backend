"use strict";

require("dotenv").config({ quiet: true });

function positiveIntFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

module.exports = {
  port: positiveIntFromEnv("PORT", 5000),
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // No authentication in this MVP: every request acts for this single demo player.
  demoPlayer: { id: "demo-player", name: "Demo Player" },
  wallet: {
    currencyCode: "VC",
    // Amounts are integers in minor units. With 2 decimals, 100000 = 1,000.00 VC.
    decimals: 2,
    startingBalance: positiveIntFromEnv("DEMO_STARTING_BALANCE", 100000),
  },
};
