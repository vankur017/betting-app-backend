"use strict";

const { AppError } = require("../utils/AppError");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Finds a stored round of one game, or throws the same 400/404 errors for every game. */
function findGameRound(store, roundId, game, label) {
  if (typeof roundId !== "string" || !UUID_PATTERN.test(roundId)) {
    throw new AppError(400, "INVALID_ROUND_ID", "roundId must be a valid round ID.", { field: "roundId" });
  }
  const round = store.rounds.get(roundId);
  if (!round || round.game !== game) {
    throw new AppError(404, "ROUND_NOT_FOUND", `${label} round not found.`);
  }
  return round;
}

/** Shared integer check for game settings sent by the client. */
function requireInteger(value, field, code, message) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new AppError(400, code, message, { field });
  }
  return value;
}

module.exports = { findGameRound, requireInteger };
