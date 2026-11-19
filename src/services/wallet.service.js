"use strict";

const { randomUUID } = require("node:crypto");
const { AppError } = require("../utils/AppError");
const { toIso } = require("../utils/time");

function createWalletService({ store, clock }) {
  function append(type, amount, roundId) {
    // A round may have at most one entry of each type: blocks double debit and double settlement.
    if (roundId && store.transactions.some((t) => t.roundId === roundId && t.type === type)) {
      throw new AppError(409, "DUPLICATE_SETTLEMENT", "This round has already been settled.");
    }
    const now = clock();
    const balanceAfter = store.wallet.balance + amount;
    if (balanceAfter < 0) {
      throw new AppError(422, "INSUFFICIENT_BALANCE", "Not enough virtual coins for this stake.");
    }
    const entry = { id: randomUUID(), type, amount, balanceAfter, roundId, createdAt: now };
    store.transactions.push(entry);
    store.wallet.balance = balanceAfter;
    store.wallet.updatedAt = now;
    return entry;
  }

  function assertPositiveAmount(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`Wallet amount must be a positive integer, got ${amount}`);
    }
  }

  return {
    getBalance() {
      return store.wallet.balance;
    },

    getWallet() {
      const w = store.wallet;
      return {
        playerId: w.playerId,
        playerName: w.playerName,
        currencyCode: w.currencyCode,
        decimals: w.decimals,
        balance: w.balance,
        updatedAt: toIso(w.updatedAt),
      };
    },

    recentTransactions(limit) {
      return store.transactions
        .slice(-limit)
        .reverse()
        .map((t) => ({ ...t, createdAt: toIso(t.createdAt) }));
    },

    debit(amount, { type, roundId }) {
      assertPositiveAmount(amount);
      if (store.wallet.balance < amount) {
        throw new AppError(422, "INSUFFICIENT_BALANCE", "Not enough virtual coins for this stake.", {
          balance: store.wallet.balance,
          required: amount,
        });
      }
      return append(type, -amount, roundId);
    },

    credit(amount, { type, roundId }) {
      assertPositiveAmount(amount);
      return append(type, amount, roundId);
    },
  };
}

module.exports = { createWalletService };
