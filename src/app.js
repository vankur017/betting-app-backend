"use strict";

const express = require("express");
const cors = require("cors");
const defaultConfig = require("./config");
const gamesConfig = require("./config/games");
const { createMemoryStore } = require("./store/memoryStore");
const { createWalletService } = require("./services/wallet.service");
const { createIdempotencyService } = require("./services/idempotency.service");
const { createCrashService } = require("./services/crash.service");
const { createHistoryService } = require("./services/history.service");
const { createCrashController } = require("./controllers/crash.controller");
const { createWalletController } = require("./controllers/wallet.controller");
const { createHistoryController } = require("./controllers/history.controller");
const { createApiRouter } = require("./routes");
const { notFound } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express app. Tests can pass a fake `clock`, a fixed `generateCrashPoint`,
 * or `wallet` overrides such as a different starting balance.
 */
function createApp(options = {}) {
  const clock = options.clock ?? Date.now;
  const walletConfig = { ...defaultConfig.wallet, ...(options.wallet ?? {}) };

  const store = createMemoryStore({ demoPlayer: defaultConfig.demoPlayer, wallet: walletConfig, now: clock() });
  const wallet = createWalletService({ store, clock });
  const idempotency = createIdempotencyService({ store });
  const crashService = createCrashService({
    store,
    wallet,
    idempotency,
    clock,
    config: gamesConfig.crash,
    generateCrashPoint: options.generateCrashPoint,
  });
  const historyService = createHistoryService({ store, crashService });

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: options.corsOrigins ?? defaultConfig.corsOrigins, exposedHeaders: ["Idempotent-Replayed"] }));
  app.use(express.json({ limit: "10kb" }));

  app.use(
    "/api",
    createApiRouter({
      crashController: createCrashController(crashService),
      walletController: createWalletController(wallet),
      historyController: createHistoryController(historyService),
    }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
