"use strict";

const { AppError } = require("../utils/AppError");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

function createHistoryController(historyService) {
  return {
    recent(req, res) {
      res.json({ success: true, data: historyService.recent(parseLimit(req.query.limit)) });
    },
  };
}

module.exports = { createHistoryController };
