"use strict";

const express = require("express");
const cors = require("cors");
const defaultConfig = require("./config");
const gamesConfig = require("./config/games");
const { createMemoryStore } = require("./store/memoryStore");
const { createFileStore } = require("./store/fileStore");
const { createWalletService } = require("./services/wallet.service");
const { createIdempotencyService } = require("./services/idempotency.service");
const { createCrashService } = require("./services/crash.service");
const { createPlinkoService } = require("./services/plinko.service");
const { createDiceService } = require("./services/dice.service");
const { createMinesService } = require("./services/mines.service");
const { createHistoryService } = require("./services/history.service");
const { createCrashController } = require("./controllers/crash.controller");
const {
  createPlinkoController,
  createDiceController,
  createMinesController,
} = require("./controllers/games.play.controller");
const { createWalletController } = require("./controllers/wallet.controller");
const { createHistoryController } = require("./controllers/history.controller");
const { createApiRouter } = require("./routes");
const { notFound } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express app. Tests can pass a fake `clock`, fixed outcomes (`generateCrashPoint`,
 * `generatePlinkoPath(rows)`, `generateDiceRoll()`, `generateMinePositions(tileCount, mineCount)`),
 * or `wallet` overrides such as a different starting balance.
 * Pass `dataFile` to keep data in a JSON file across restarts; without it, data is in memory only.
 */
function createApp(options = {}) {
  const clock = options.clock ?? Date.now;
  const walletConfig = { ...defaultConfig.wallet, ...(options.wallet ?? {}) };

  const storeOptions = { demoPlayer: defaultConfig.demoPlayer, wallet: walletConfig, now: clock() };
  let store;
  let saveStore = null;
  if (options.dataFile) {
    ({ store, save: saveStore } = createFileStore({ ...storeOptions, filePath: options.dataFile }));
  } else {
    store = createMemoryStore(storeOptions);
  }

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
  const shared = { store, wallet, idempotency, clock };
  const plinkoService = createPlinkoService({ ...shared, config: gamesConfig.plinko, generatePath: options.generatePlinkoPath });
  const diceService = createDiceService({ ...shared, config: gamesConfig.dice, generateRoll: options.generateDiceRoll });
  const minesService = createMinesService({ ...shared, config: gamesConfig.mines, generateMinePositions: options.generateMinePositions });
  const historyService = createHistoryService({ store, crashService });

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: options.corsOrigins ?? defaultConfig.corsOrigins, exposedHeaders: ["Idempotent-Replayed"] }));
  app.use(express.json({ limit: "10kb" }));

  if (saveStore) {
    // Save before every JSON response (errors too: reading a round can mark it CRASHED),
    // so anything the client is told has already been written to disk.
    app.use((req, res, next) => {
      const sendJson = res.json.bind(res);
      res.json = (body) => {
        try {
          saveStore();
        } catch (err) {
          console.error("[store] Failed to save data file:", err);
        }
        return sendJson(body);
      };
      next();
    });
  }

  app.use(
    "/api",
    createApiRouter({
      crashController: createCrashController(crashService),
      plinkoController: createPlinkoController(plinkoService),
      diceController: createDiceController(diceService),
      minesController: createMinesController(minesService),
      walletController: createWalletController(wallet),
      historyController: createHistoryController(historyService),
    }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
