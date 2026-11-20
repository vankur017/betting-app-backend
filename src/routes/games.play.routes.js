"use strict";

const express = require("express");

function createPlinkoRoutes(controller) {
  const router = express.Router();
  router.post("/play", controller.play);
  router.get("/rounds/:roundId", controller.getRound);
  return router;
}

function createDiceRoutes(controller) {
  const router = express.Router();
  router.post("/roll", controller.roll);
  router.get("/rounds/:roundId", controller.getRound);
  return router;
}

function createMinesRoutes(controller) {
  const router = express.Router();
  router.post("/start", controller.start);
  router.post("/reveal", controller.reveal);
  router.post("/cashout", controller.cashout);
  // The running round (or null), so the client can resume after a page refresh.
  router.get("/active", controller.getActive);
  router.get("/rounds/:roundId", controller.getRound);
  return router;
}

module.exports = { createPlinkoRoutes, createDiceRoutes, createMinesRoutes };
