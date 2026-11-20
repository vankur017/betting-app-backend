"use strict";

/** HTTP mapping only for Plinko, Dice and Mines. Game logic lives in the services. */

function sendCreated(res, { replayed, ...data }) {
  if (replayed) res.set("Idempotent-Replayed", "true");
  res.status(201).json({ success: true, data });
}

function createPlinkoController(plinkoService) {
  return {
    play(req, res) {
      sendCreated(
        res,
        plinkoService.play({
          stake: req.body?.stake,
          rows: req.body?.rows,
          risk: req.body?.risk,
          idempotencyKey: req.get("Idempotency-Key"),
        }),
      );
    },
    getRound(req, res) {
      res.json({ success: true, data: plinkoService.getRound(req.params.roundId) });
    },
  };
}

function createDiceController(diceService) {
  return {
    roll(req, res) {
      sendCreated(
        res,
        diceService.roll({
          stake: req.body?.stake,
          target: req.body?.target,
          direction: req.body?.direction,
          idempotencyKey: req.get("Idempotency-Key"),
        }),
      );
    },
    getRound(req, res) {
      res.json({ success: true, data: diceService.getRound(req.params.roundId) });
    },
  };
}

function createMinesController(minesService) {
  return {
    start(req, res) {
      sendCreated(
        res,
        minesService.start({
          stake: req.body?.stake,
          mineCount: req.body?.mineCount,
          idempotencyKey: req.get("Idempotency-Key"),
        }),
      );
    },
    reveal(req, res) {
      res.json({ success: true, data: minesService.reveal({ roundId: req.body?.roundId, tile: req.body?.tile }) });
    },
    cashout(req, res) {
      res.json({ success: true, data: minesService.cashout({ roundId: req.body?.roundId }) });
    },
    getActive(req, res) {
      res.json({ success: true, data: minesService.getActive() });
    },
    getRound(req, res) {
      res.json({ success: true, data: minesService.getRound(req.params.roundId) });
    },
  };
}

module.exports = { createPlinkoController, createDiceController, createMinesController };
