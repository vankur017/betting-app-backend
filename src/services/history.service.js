"use strict";

const { toIso } = require("../utils/time");
const { formatMultiplier } = require("../games/shared/math");
const { formatRoll } = require("../games/dice/dice.rules");

/**
 * Short result for chips in the UI: the crash point, the Plinko bucket, the dice roll, or the
 * Mines cash-out ("Bust" after a mine). Null while a round is still running.
 */
function resultLabel(round) {
  if (round.status === "RUNNING") return null;
  switch (round.game) {
    case "crash":
      return round.crash ? formatMultiplier(round.crash.crashX100) : null;
    case "plinko":
      return round.plinko ? formatMultiplier(round.plinko.multiplierX100) : null;
    case "dice":
      return round.dice ? formatRoll(round.dice.roll) : null;
    case "mines":
      if (round.status === "BUSTED") return "Bust";
      return round.mines ? formatMultiplier(round.mines.cashoutMultiplierX100 ?? 100) : null;
    default:
      return null;
  }
}

function createHistoryService({ store, crashService }) {
  return {
    /** Newest first. `game` (optional) keeps only that game's rounds. */
    recent(limit, game) {
      crashService.syncActive();
      return Array.from(store.rounds.values())
        .filter((round) => !game || round.game === game)
        .reverse()
        .slice(0, limit)
        .map((round) => ({
          roundId: round.id,
          game: round.game,
          status: round.status,
          stake: round.stake,
          virtualReturn: round.virtualReturn,
          outcomeSummary: round.outcomeSummary,
          resultLabel: resultLabel(round),
          startedAt: toIso(round.startedAt),
          completedAt: toIso(round.completedAt),
        }));
    },
  };
}

module.exports = { createHistoryService, resultLabel };
