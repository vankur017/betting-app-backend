"use strict";

const { AppError } = require("../utils/AppError");
const { games } = require("../config/games");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const GAME_IDS = games.map((g) => g.id);

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new AppError(400, "INVALID_LIMIT", `limit must be a whole number from 1 to ${MAX_LIMIT}.`, {
      field: "limit",
    });
  }
  return limit;
}

function parseGame(raw) {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !GAME_IDS.includes(raw)) {
    throw new AppError(400, "INVALID_GAME", `game must be one of ${GAME_IDS.join(", ")}.`, {
      field: "game",
      allowed: GAME_IDS,
    });
  }
  return raw;
}

function createHistoryController(historyService) {
  return {
    recent(req, res) {
      const data = historyService.recent(parseLimit(req.query.limit), parseGame(req.query.game));
      res.json({ success: true, data });
    },
  };
}

module.exports = { createHistoryController };
