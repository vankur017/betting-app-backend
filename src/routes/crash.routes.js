"use strict";

const express = require("express");

function createCrashRoutes(controller) {
  const router = express.Router();
  router.post("/start", controller.start);
  router.post("/cashout", controller.cashout);
  // Polled by the client to learn when a running round crashes.
  router.get("/rounds/:roundId", controller.getRound);
  return router;
}

module.exports = { createCrashRoutes };
