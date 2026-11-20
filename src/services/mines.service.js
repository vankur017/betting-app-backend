"use strict";

const { randomUUID } = require("node:crypto");
const rules = require("../games/mines/mines.rules");
const { payoutFor, formatMultiplier } = require("../games/shared/math");
const { AppError } = require("../utils/AppError");
const { toIso } = require("../utils/time");
const { validateStake } = require("./stake");
const { findGameRound, requireInteger } = require("./rounds");

/**
 * Mines round lifecycle: RUNNING -> CASHED_OUT (player cashes out, or reveals every safe tile)
 * or BUSTED (player reveals a mine, stake lost). Mine positions never leave the server while the
 * round is RUNNING. One running Mines round at a time.
 */
function createMinesService({ store, wallet, idempotency, clock, config, generateMinePositions }) {
  const nextMines =
    generateMinePositions ?? ((tileCount, mineCount) => rules.generateMinePositions(tileCount, mineCount));
  const safeTileCount = (round) => config.tileCount - round.mines.mineCount;
  const multiplierFor = (round, reveals) => rules.multiplierX100(reveals, round.mines.mineCount, config);

  function toDto(round) {
    const m = round.mines;
    const safeReveals = m.revealed.length;
    const dto = {
      roundId: round.id,
      game: "mines",
      status: round.status,
      stake: round.stake,
      configVersion: round.configVersion,
      gridSize: config.gridSize,
      tileCount: config.tileCount,
      mineCount: m.mineCount,
      revealedTiles: [...m.revealed],
      safeReveals,
      currentMultiplierX100: multiplierFor(round, safeReveals),
      startedAt: toIso(round.startedAt),
    };
    if (round.status === "RUNNING") {
      const hasNext = safeReveals < safeTileCount(round);
      return {
        ...dto,
        nextMultiplierX100: hasNext ? multiplierFor(round, safeReveals + 1) : null,
        potentialReturn: safeReveals > 0 ? payoutFor(round.stake, multiplierFor(round, safeReveals)) : null,
      };
    }
    return {
      ...dto,
      minePositions: [...m.minePositions],
      hitMine: m.hitMine,
      cashoutMultiplierX100: m.cashoutMultiplierX100,
      virtualReturn: round.virtualReturn,
      outcomeSummary: round.outcomeSummary,
      completedAt: toIso(round.completedAt),
    };
  }

  function result(round, extra = {}) {
    return { round: toDto(round), balance: wallet.getBalance(), ...extra };
  }

  function findRound(roundId) {
    return findGameRound(store, roundId, "mines", "Mines");
  }

  function settle(round, now, summaryPrefix) {
    const m = round.mines;
    const multiplierX100 = multiplierFor(round, m.revealed.length);
    const virtualReturn = payoutFor(round.stake, multiplierX100);
    if (virtualReturn > 0) wallet.credit(virtualReturn, { type: "ROUND_RETURN", roundId: round.id });
    round.status = "CASHED_OUT";
    m.cashoutMultiplierX100 = multiplierX100;
    round.virtualReturn = virtualReturn;
    round.completedAt = now;
    round.outcomeSummary = `${summaryPrefix} at ${formatMultiplier(multiplierX100)} (${m.revealed.length} safe tiles)`;
    store.activeMinesRoundId = null;
  }

  function validateMineCount(mineCount) {
    requireInteger(mineCount, "mineCount", "INVALID_MINE_COUNT", "mineCount must be a whole number.");
    if (mineCount < config.minMines || mineCount > config.maxMines) {
      throw new AppError(
        400,
        "INVALID_MINE_COUNT",
        `mineCount must be between ${config.minMines} and ${config.maxMines}.`,
        { field: "mineCount", minMines: config.minMines, maxMines: config.maxMines },
      );
    }
  }

  function createRound(stake, mineCount) {
    if (store.activeMinesRoundId) {
      const active = store.rounds.get(store.activeMinesRoundId);
      if (active && active.status === "RUNNING") {
        throw new AppError(409, "ROUND_IN_PROGRESS", "Finish the current Mines round first.", {
          roundId: active.id,
        });
      }
      store.activeMinesRoundId = null;
    }

    const minePositions = nextMines(config.tileCount, mineCount);
    if (!rules.isValidMinePositions(minePositions, config.tileCount, mineCount)) {
      throw new Error("Mine generator returned invalid positions");
    }
    const round = {
      id: randomUUID(),
      game: "mines",
      status: "RUNNING",
      stake,
      configVersion: config.configVersion,
      startedAt: clock(),
      completedAt: null,
      virtualReturn: null,
      outcomeSummary: null,
      mines: {
        mineCount,
        minePositions: [...minePositions].sort((a, b) => a - b), // secret until the round ends
        revealed: [],
        hitMine: null,
        cashoutMultiplierX100: null,
      },
    };

    wallet.debit(stake, { type: "STAKE_DEBIT", roundId: round.id });
    store.rounds.set(round.id, round);
    store.activeMinesRoundId = round.id;
    return round.id;
  }

  return {
    start({ stake, mineCount, idempotencyKey }) {
      validateStake(stake, config);
      validateMineCount(mineCount);
      const { value: roundId, replayed } = idempotency.run(
        "mines:start",
        idempotencyKey,
        `stake=${stake};mineCount=${mineCount}`,
        () => createRound(stake, mineCount),
      );
      return { ...result(store.rounds.get(roundId)), replayed };
    },

    /** The running round, so the client can resume after a refresh. Null when there is none. */
    getActive() {
      const round = store.activeMinesRoundId ? store.rounds.get(store.activeMinesRoundId) : null;
      if (!round || round.status !== "RUNNING") return { round: null, balance: wallet.getBalance() };
      return result(round);
    },

    getRound(roundId) {
      return result(findRound(roundId));
    },

    reveal({ roundId, tile }) {
      const round = findRound(roundId);
      requireInteger(tile, "tile", "INVALID_TILE", `tile must be a whole number from 0 to ${config.tileCount - 1}.`);
      if (tile < 0 || tile >= config.tileCount) {
        throw new AppError(400, "INVALID_TILE", `tile must be a whole number from 0 to ${config.tileCount - 1}.`, {
          field: "tile",
        });
      }
      if (round.status !== "RUNNING") {
        throw new AppError(409, "ROUND_ENDED", "This Mines round has already ended.", { round: toDto(round) });
      }

      const m = round.mines;
      // Repeated reveal of the same safe tile (e.g. a retried request): report the state, change nothing.
      if (m.revealed.includes(tile)) return result(round, { alreadyRevealed: true });

      const now = clock();
      if (m.minePositions.includes(tile)) {
        round.status = "BUSTED";
        m.hitMine = tile;
        round.virtualReturn = 0;
        round.completedAt = now;
        round.outcomeSummary = `Hit a mine after ${m.revealed.length} safe tiles`;
        store.activeMinesRoundId = null;
        // Nothing to settle: the stake was debited when the round started.
        return result(round, { alreadyRevealed: false });
      }

      m.revealed.push(tile);
      if (m.revealed.length === safeTileCount(round)) settle(round, now, "Cleared the board");
      return result(round, { alreadyRevealed: false });
    },

    cashout({ roundId }) {
      const round = findRound(roundId);
      if (round.status === "CASHED_OUT") return result(round, { alreadySettled: true });
      if (round.status === "BUSTED") {
        throw new AppError(409, "ROUND_BUSTED", "This round hit a mine. The stake was lost.", { round: toDto(round) });
      }
      if (round.mines.revealed.length === 0) {
        throw new AppError(409, "NO_SAFE_REVEALS", "Reveal at least one safe tile before cashing out.");
      }
      settle(round, clock(), "Cashed out");
      return result(round, { alreadySettled: false });
    },
  };
}

module.exports = { createMinesService };
