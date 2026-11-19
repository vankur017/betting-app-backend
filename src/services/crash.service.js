"use strict";

const { randomUUID } = require("node:crypto");
const rules = require("../games/crash/crash.rules");
const { AppError } = require("../utils/AppError");
const { toIso } = require("../utils/time");
const { validateStake } = require("./stake");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crash round lifecycle. The server owns the clock and the crash point:
 * RUNNING -> CASHED_OUT (valid cash-out before the crash time) or CRASHED (stake lost).
 * Rounds crash lazily: their state is brought up to date whenever they are read.
 */
function createCrashService({ store, wallet, idempotency, clock, config, generateCrashPoint }) {
  const nextCrashPoint = generateCrashPoint ?? (() => rules.generateCrashPointX100(config));

  function sync(round, now) {
    if (round.status === "RUNNING" && now - round.startedAt >= round.crash.durationMs) {
      round.status = "CRASHED";
      round.virtualReturn = 0;
      round.completedAt = round.startedAt + round.crash.durationMs;
      round.outcomeSummary = `Crashed at ${rules.formatMultiplier(round.crash.crashX100)}`;
      // Nothing to settle: the stake was debited when the round started.
    }
    if (round.status !== "RUNNING" && store.activeCrashRoundId === round.id) {
      store.activeCrashRoundId = null;
    }
    return round;
  }

  /** Client view of a round. The crash point stays secret while the round is running. */
  function toDto(round, now) {
    const dto = {
      roundId: round.id,
      game: "crash",
      status: round.status,
      stake: round.stake,
      configVersion: round.configVersion,
      startedAt: toIso(round.startedAt),
      serverTime: toIso(now),
      // The curve shape is public; only the crash point is secret while running.
      curve: { type: "exponential", growthPerMs: config.growthPerMs },
    };
    if (round.status === "RUNNING") {
      const elapsedMs = now - round.startedAt;
      return {
        ...dto,
        elapsedMs,
        currentMultiplierX100: rules.multiplierAtX100(elapsedMs, config),
      };
    }
    return {
      ...dto,
      crashMultiplierX100: round.crash.crashX100,
      cashoutMultiplierX100: round.crash.cashoutX100,
      virtualReturn: round.virtualReturn,
      outcomeSummary: round.outcomeSummary,
      completedAt: toIso(round.completedAt),
    };
  }

  function findRound(roundId) {
    if (typeof roundId !== "string" || !UUID_PATTERN.test(roundId)) {
      throw new AppError(400, "INVALID_ROUND_ID", "roundId must be a valid round ID.", { field: "roundId" });
    }
    const round = store.rounds.get(roundId);
    if (!round || round.game !== "crash") {
      throw new AppError(404, "ROUND_NOT_FOUND", "Crash round not found.");
    }
    return round;
  }

  function createRound(stake) {
    const now = clock();
    if (store.activeCrashRoundId) {
      const active = sync(store.rounds.get(store.activeCrashRoundId), now);
      if (active.status === "RUNNING") {
        throw new AppError(409, "ROUND_IN_PROGRESS", "Finish the current Crash round first.", {
          roundId: active.id,
        });
      }
    }

    const crashX100 = nextCrashPoint();
    const round = {
      id: randomUUID(),
      game: "crash",
      status: "RUNNING",
      stake,
      configVersion: config.configVersion,
      startedAt: now,
      completedAt: null,
      virtualReturn: null,
      outcomeSummary: null,
      crash: {
        crashX100, // secret until the round ends
        durationMs: rules.crashDurationMs(crashX100, config),
        cashoutX100: null,
        cashoutAt: null,
      },
    };

    // Debit first: if the balance is too low nothing is stored.
    wallet.debit(stake, { type: "STAKE_DEBIT", roundId: round.id });
    store.rounds.set(round.id, round);
    store.activeCrashRoundId = round.id;
    return round.id;
  }

  return {
    syncActive() {
      if (store.activeCrashRoundId) sync(store.rounds.get(store.activeCrashRoundId), clock());
    },

    start({ stake, idempotencyKey }) {
      validateStake(stake, config);
      const { value: roundId, replayed } = idempotency.run(
        "crash:start",
        idempotencyKey,
        `stake=${stake}`,
        () => createRound(stake),
      );
      const now = clock();
      const round = sync(store.rounds.get(roundId), now);
      return { round: toDto(round, now), balance: wallet.getBalance(), replayed };
    },

    getRound(roundId) {
      const now = clock();
      const round = sync(findRound(roundId), now);
      return { round: toDto(round, now), balance: wallet.getBalance() };
    },

    /** Any multiplier or amount sent by the client is ignored; only server time counts. */
    cashout({ roundId }) {
      const now = clock();
      const round = sync(findRound(roundId), now);

      if (round.status === "CASHED_OUT") {
        // Repeated cash-out: report the existing settlement, credit nothing.
        return { round: toDto(round, now), balance: wallet.getBalance(), alreadySettled: true };
      }
      if (round.status === "CRASHED") {
        throw new AppError(409, "ROUND_CRASHED", "Too late: the round crashed before the cash-out.", {
          round: toDto(round, now),
          balance: wallet.getBalance(),
        });
      }

      const cashoutX100 = rules.multiplierAtX100(now - round.startedAt, config);
      const virtualReturn = rules.payoutFor(round.stake, cashoutX100);
      wallet.credit(virtualReturn, { type: "ROUND_RETURN", roundId: round.id });

      round.status = "CASHED_OUT";
      round.crash.cashoutX100 = cashoutX100;
      round.crash.cashoutAt = now;
      round.virtualReturn = virtualReturn;
      round.completedAt = now;
      round.outcomeSummary = `Cashed out at ${rules.formatMultiplier(cashoutX100)}`;
      store.activeCrashRoundId = null;

      return { round: toDto(round, now), balance: wallet.getBalance(), alreadySettled: false };
    },
  };
}

module.exports = { createCrashService };
