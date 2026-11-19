"use strict";

const { toIso } = require("../utils/time");

function createHistoryService({ store, crashService }) {
  return {
    recent(limit) {
      crashService.syncActive();
      return Array.from(store.rounds.values())
        .reverse()
        .slice(0, limit)
        .map((round) => ({
          roundId: round.id,
          game: round.game,
          status: round.status,
          stake: round.stake,
          virtualReturn: round.virtualReturn,
          outcomeSummary: round.outcomeSummary,
          startedAt: toIso(round.startedAt),
          completedAt: toIso(round.completedAt),
        }));
    },
  };
}

module.exports = { createHistoryService };
