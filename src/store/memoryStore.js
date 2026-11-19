"use strict";

const { randomUUID } = require("node:crypto");

/**
 * In-memory data for the demo player. Everything resets when the server restarts.
 * Phase 3 replaces this with PostgreSQL + Prisma.
 */
function createMemoryStore({ demoPlayer, wallet, now }) {
  return {
    wallet: {
      playerId: demoPlayer.id,
      playerName: demoPlayer.name,
      currencyCode: wallet.currencyCode,
      decimals: wallet.decimals,
      balance: wallet.startingBalance,
      updatedAt: now,
    },
    // Append-only ledger. The starter grant is written exactly once, here.
    transactions: [
      {
        id: randomUUID(),
        type: "STARTER_GRANT",
        amount: wallet.startingBalance,
        balanceAfter: wallet.startingBalance,
        roundId: null,
        createdAt: now,
      },
    ],
    rounds: new Map(), // roundId -> round, in creation order
    activeCrashRoundId: null,
    idempotency: new Map(),
  };
}

module.exports = { createMemoryStore };
