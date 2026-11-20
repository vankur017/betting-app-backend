"use strict";

const { randomUUID } = require("node:crypto");
const rules = require("../games/dice/dice.rules");
const { payoutFor, formatMultiplier } = require("../games/shared/math");
const { AppError } = require("../utils/AppError");
const { toIso } = require("../utils/time");
const { validateStake } = require("./stake");
const { findGameRound, requireInteger } = require("./rounds");

/**
 * Dice is an instant game: one request debits the stake, rolls on the server and settles.
 * `target` is in hundredths (5000 = 50.00). The multiplier is always computed here.
 */
function createDiceService({ store, wallet, idempotency, clock, config, generateRoll }) {
  const nextRoll = generateRoll ?? (() => rules.generateRollX100(config));

  function validateBet(target, direction) {
    if (typeof direction !== "string" || !rules.DIRECTIONS.includes(direction)) {
      throw new AppError(400, "INVALID_DIRECTION", 'direction must be "under" or "over".', {
        field: "direction",
        allowed: rules.DIRECTIONS,
      });
    }
    requireInteger(target, "target", "INVALID_TARGET", "target must be a whole number in hundredths (5000 = 50.00).");
    const { minTarget, maxTarget } = rules.targetRange(direction, config);
    if (target < minTarget || target > maxTarget) {
      throw new AppError(
        400,
        "TARGET_OUT_OF_RANGE",
        `For "${direction}", target must be between ${minTarget} and ${maxTarget}.`,
        { field: "target", direction, minTarget, maxTarget },
      );
    }
    const wins = rules.winCount(target, direction, config);
    return { winChanceBps: wins, multiplierX100: rules.multiplierX100(wins, config) };
  }

  function toDto(round) {
    const d = round.dice;
    return {
      roundId: round.id,
      game: "dice",
      status: round.status,
      stake: round.stake,
      configVersion: round.configVersion,
      target: d.target,
      direction: d.direction,
      // Win chance in basis points of 100%: 5000 = 50.00%.
      winChanceBps: d.winChanceBps,
      multiplierX100: d.multiplierX100,
      roll: d.roll,
      won: d.won,
      virtualReturn: round.virtualReturn,
      outcomeSummary: round.outcomeSummary,
      startedAt: toIso(round.startedAt),
      completedAt: toIso(round.completedAt),
    };
  }

  function createRound(stake, target, direction, bet) {
    const roll = nextRoll();
    if (!Number.isInteger(roll) || roll < 0 || roll >= config.rollSpan) {
      throw new Error("Dice roll generator returned an invalid roll");
    }
    const won = rules.isWin(roll, target, direction);
    const virtualReturn = won ? payoutFor(stake, bet.multiplierX100) : 0;
    const now = clock();
    const rollText = `Rolled ${rules.formatRoll(roll)} (${direction} ${rules.formatRoll(target)})`;
    const round = {
      id: randomUUID(),
      game: "dice",
      status: won ? "WON" : "LOST",
      stake,
      configVersion: config.configVersion,
      startedAt: now,
      completedAt: now,
      virtualReturn,
      outcomeSummary: won ? `${rollText}: won at ${formatMultiplier(bet.multiplierX100)}` : `${rollText}: lost`,
      dice: { target, direction, winChanceBps: bet.winChanceBps, multiplierX100: bet.multiplierX100, roll, won },
    };

    wallet.debit(stake, { type: "STAKE_DEBIT", roundId: round.id });
    if (virtualReturn > 0) wallet.credit(virtualReturn, { type: "ROUND_RETURN", roundId: round.id });
    store.rounds.set(round.id, round);
    return round.id;
  }

  return {
    roll({ stake, target, direction, idempotencyKey }) {
      validateStake(stake, config);
      const bet = validateBet(target, direction);
      const { value: roundId, replayed } = idempotency.run(
        "dice:roll",
        idempotencyKey,
        `stake=${stake};target=${target};direction=${direction}`,
        () => createRound(stake, target, direction, bet),
      );
      return { round: toDto(store.rounds.get(roundId)), balance: wallet.getBalance(), replayed };
    },

    getRound(roundId) {
      return { round: toDto(findGameRound(store, roundId, "dice", "Dice")), balance: wallet.getBalance() };
    },
  };
}

module.exports = { createDiceService };
