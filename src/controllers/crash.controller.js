"use strict";

function createCrashController(crashService) {
  return {
    start(req, res) {
      const { replayed, ...data } = crashService.start({
        stake: req.body?.stake,
        idempotencyKey: req.get("Idempotency-Key"),
      });
      if (replayed) res.set("Idempotent-Replayed", "true");
      res.status(201).json({ success: true, data });
    },

    cashout(req, res) {
      res.json({ success: true, data: crashService.cashout({ roundId: req.body?.roundId }) });
    },

    getRound(req, res) {
      res.json({ success: true, data: crashService.getRound(req.params.roundId) });
    },
  };
}

module.exports = { createCrashController };
