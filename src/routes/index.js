"use strict";

const express = require("express");
const { health } = require("../controllers/health.controller");
const { listGames } = require("../controllers/games.controller");
const { createCrashRoutes } = require("./crash.routes");

function createApiRouter({ crashController, walletController, historyController }) {
  const router = express.Router();
  router.get("/health", health);
  router.get("/games", listGames);
  router.use("/games/crash", createCrashRoutes(crashController));
  router.get("/wallet", walletController.getWallet);
  router.get("/history", historyController.recent);
  return router;
}

module.exports = { createApiRouter };
