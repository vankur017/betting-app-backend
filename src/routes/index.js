"use strict";

const express = require("express");
const { health } = require("../controllers/health.controller");
const { listGames } = require("../controllers/games.controller");
const { createCrashRoutes } = require("./crash.routes");
const { createPlinkoRoutes, createDiceRoutes, createMinesRoutes } = require("./games.play.routes");

function createApiRouter({
  crashController,
  plinkoController,
  diceController,
  minesController,
  walletController,
  historyController,
}) {
  const router = express.Router();
  router.get("/health", health);
  router.get("/games", listGames);
  router.use("/games/crash", createCrashRoutes(crashController));
  router.use("/games/plinko", createPlinkoRoutes(plinkoController));
  router.use("/games/dice", createDiceRoutes(diceController));
  router.use("/games/mines", createMinesRoutes(minesController));
  router.get("/wallet", walletController.getWallet);
  router.get("/history", historyController.recent);
  return router;
}

module.exports = { createApiRouter };
