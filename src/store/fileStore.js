"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createMemoryStore } = require("./memoryStore");

/**
 * File-backed version of the in-memory store, so data survives a server restart.
 * The services still work on the same plain objects; this module only loads them at startup
 * and writes a JSON snapshot after each request. Phase 3 replaces this with PostgreSQL + Prisma.
 */
const SCHEMA_VERSION = 1;

function toSnapshot(store) {
  return {
    schemaVersion: SCHEMA_VERSION,
    wallet: store.wallet,
    transactions: store.transactions,
    rounds: Array.from(store.rounds.values()), // keeps creation order
    activeCrashRoundId: store.activeCrashRoundId,
    activeMinesRoundId: store.activeMinesRoundId,
    idempotency: Array.from(store.idempotency.entries()), // keeps insertion order for eviction
  };
}

function fromSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported store schemaVersion: ${snapshot && snapshot.schemaVersion}`);
  }
  if (!snapshot.wallet || !Array.isArray(snapshot.transactions) || !Array.isArray(snapshot.rounds)) {
    throw new Error("Store file is missing wallet, transactions or rounds");
  }
  return {
    wallet: snapshot.wallet,
    transactions: snapshot.transactions,
    rounds: new Map(snapshot.rounds.map((round) => [round.id, round])),
    activeCrashRoundId: snapshot.activeCrashRoundId ?? null,
    // Added after schemaVersion 1 shipped; older files simply have no running Mines round.
    activeMinesRoundId: snapshot.activeMinesRoundId ?? null,
    idempotency: new Map(snapshot.idempotency ?? []),
  };
}

/** Write to a temp file, then rename, so a crash mid-write never leaves a half-written store. */
function writeAtomic(filePath, text) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, text, "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Windows can briefly lock the target (antivirus, indexer). Fall back to a direct write.
    fs.writeFileSync(filePath, text, "utf8");
    fs.rmSync(tmpPath, { force: true });
  }
}

/**
 * Loads the store from `filePath`, or creates a fresh one if the file does not exist.
 * An unreadable file is moved aside (never deleted) and a fresh store is started.
 * Returns `{ store, save }`. `save()` writes only when the data changed.
 */
function createFileStore({ filePath, demoPlayer, wallet, now }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let store;
  if (fs.existsSync(filePath)) {
    try {
      store = fromSnapshot(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (err) {
      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      fs.renameSync(filePath, backupPath);
      console.warn(`[store] Could not read ${filePath} (${err.message}). Moved it to ${backupPath}; starting fresh.`);
    }
  }
  store ??= createMemoryStore({ demoPlayer, wallet, now });

  let lastWritten = null;
  function save() {
    const text = JSON.stringify(toSnapshot(store), null, 2);
    if (text === lastWritten) return;
    writeAtomic(filePath, text);
    lastWritten = text;
  }

  save(); // creates the file on first run
  return { store, save };
}

module.exports = { createFileStore, toSnapshot, fromSnapshot };
