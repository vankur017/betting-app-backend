"use strict";

const { randomUUID } = require("node:crypto");
const rules = require("../games/plinko/plinko.rules");
const { payoutFor, formatMultiplier } = require("../games/shared/math");
const { AppError } = require("../utils/AppError");
const { toIso } = require("../utils/time");
const { validateStake } = require("./stake");
const { findGameRound } = require("./rounds");

/**
 * Plinko is an instant game: one request debits the stake, picks the path on the server,
 * credits the return and stores a SETTLED round. The client only animates the returned path.
 */
function createPlinkoService({ store, wallet, idempotency, clock, config, generatePath }) {
  const nextPath = generatePath ?? ((rows) => rules.generatePath(rows));

  function validateSettings(rows, risk) {
    if (typeof rows !== "number" || !config.rows.includes(rows)) {
      throw new AppError(400, "INVALID_ROWS", `rows must be one of ${config.rows.join(", ")}.`, {
        field: "rows",
        allowed: config.rows,
      });
    }
    if (typeof risk !== "string" || !config.risks.includes(risk)) {
      throw new AppError(400, "INVALID_RISK", `risk must be one of ${config.risks.join(", ")}.`, {
        field: "risk",
        allowed: config.risks,
      });
    }
    return rules.multiplierTable(config, rows, risk);
  }

  function toDto(round) {
    return {
      roundId: round.id,
      game: "plinko",
      status: round.status,
      stake: round.stake,
      configVersion: round.configVersion,
      rows: round.plinko.rows,
      risk: round.plinko.risk,
      path: round.plinko.path,
      bucket: round.plinko.bucket,
      multiplierX100: round.plinko.multiplierX100,
      virtualReturn: round.virtualReturn,
      outcomeSummary: round.outcomeSummary,
      startedAt: toIso(round.startedAt),
      completedAt: toIso(round.completedAt),
    };
  }

  function createRound(stake, rows, risk, table) {
    const path = nextPath(rows);
    if (!rules.isValidPath(path, rows)) throw new Error("Plinko path generator returned an invalid path");
    const bucket = rules.bucketForPath(path);
    const multiplierX100 = table[bucket];
    const virtualReturn = payoutFor(stake, multiplierX100);
    const now = clock();
    const round = {
      id: randomUUID(),
      game: "plinko",
      status: "SETTLED",
      stake,
      configVersion: config.configVersion,
      startedAt: now,
      completedAt: now,
      virtualReturn,
      outcomeSummary: `Landed in bucket ${bucket + 1} of ${rows + 1} at ${formatMultiplier(multiplierX100)}`,
      plinko: { rows, risk, path, bucket, multiplierX100 },
    };

    // Debit first: if the balance is too low nothing is stored.
    wallet.debit(stake, { type: "STAKE_DEBIT", roundId: round.id });
    if (virtualReturn > 0) wallet.credit(virtualReturn, { type: "ROUND_RETURN", roundId: round.id });
    store.rounds.set(round.id, round);
    return round.id;
  }

  return {
    play({ stake, rows, risk, idempotencyKey }) {
      validateStake(stake, config);
      const table = validateSettings(rows, risk);
      const { value: roundId, replayed } = idempotency.run(
        "plinko:play",
        idempotencyKey,
        `stake=${stake};rows=${rows};risk=${risk}`,
        () => createRound(stake, rows, risk, table),
      );
      return { round: toDto(store.rounds.get(roundId)), balance: wallet.getBalance(), replayed };
    },

    getRound(roundId) {
      return { round: toDto(findGameRound(store, roundId, "plinko", "Plinko")), balance: wallet.getBalance() };
    },
  };
}

module.exports = { createPlinkoService };
