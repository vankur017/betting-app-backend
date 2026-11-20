"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../src/app");

const START = 1_800_000_000_000;
const STARTING_BALANCE = 100000;

function tempDataFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betting-store-"));
  return { dir, file: path.join(dir, "store.json") };
}

/** Starts the API backed by `dataFile`, runs `fn`, then stops it (a "server restart" between calls). */
async function withServer(dataFile, clockState, fn) {
  const app = createApp({ clock: () => clockState.now, generateCrashPoint: () => 200, dataFile });
  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    return await fn(call);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("balance, ledger and history survive a restart", async () => {
  const { dir, file } = tempDataFile();
  const clock = { now: START };
  try {
    const roundId = await withServer(file, clock, async (call) => {
      const started = await call("POST", "/games/crash/start", { stake: 1000 }, { "Idempotency-Key": randomUUID() });
      assert.equal(started.status, 201);
      clock.now += 5000;
      const cashed = await call("POST", "/games/crash/cashout", { roundId: started.body.data.round.roundId });
      assert.equal(cashed.body.data.round.status, "CASHED_OUT");
      return started.body.data.round.roundId;
    });

    assert.ok(fs.existsSync(file), "data file is written");

    await withServer(file, clock, async (call) => {
      const wallet = await call("GET", "/wallet");
      assert.notEqual(wallet.body.data.balance, STARTING_BALANCE);
      assert.ok(wallet.body.data.balance > STARTING_BALANCE - 1000);

      const history = await call("GET", "/history");
      assert.equal(history.body.data[0].roundId, roundId);
      assert.equal(history.body.data[0].status, "CASHED_OUT");

      const round = await call("GET", `/games/crash/rounds/${roundId}`);
      assert.equal(round.status, 200);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a running round that passes its crash time while the server is down is CRASHED after restart", async () => {
  const { dir, file } = tempDataFile();
  const clock = { now: START };
  try {
    const { roundId, balanceAfterStake } = await withServer(file, clock, async (call) => {
      const started = await call("POST", "/games/crash/start", { stake: 1000 }, { "Idempotency-Key": randomUUID() });
      return { roundId: started.body.data.round.roundId, balanceAfterStake: started.body.data.balance };
    });

    clock.now += 60_000; // well past the 2.00x crash point

    await withServer(file, clock, async (call) => {
      const late = await call("POST", "/games/crash/cashout", { roundId });
      assert.equal(late.status, 409);
      assert.equal(late.body.error.code, "ROUND_CRASHED");
      assert.equal((await call("GET", "/wallet")).body.data.balance, balanceAfterStake);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("idempotent start is still replayed after a restart", async () => {
  const { dir, file } = tempDataFile();
  const clock = { now: START };
  const key = randomUUID();
  try {
    const first = await withServer(file, clock, (call) =>
      call("POST", "/games/crash/start", { stake: 1000 }, { "Idempotency-Key": key }),
    );
    const again = await withServer(file, clock, (call) =>
      call("POST", "/games/crash/start", { stake: 1000 }, { "Idempotency-Key": key }),
    );
    assert.equal(again.body.data.round.roundId, first.body.data.round.roundId);
    assert.equal(again.body.data.balance, STARTING_BALANCE - 1000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable data file is moved aside and a fresh store starts", async () => {
  const { dir, file } = tempDataFile();
  fs.writeFileSync(file, "{ not json");
  const warn = console.warn;
  console.warn = () => {};
  try {
    await withServer(file, { now: START }, async (call) => {
      assert.equal((await call("GET", "/wallet")).body.data.balance, STARTING_BALANCE);
    });
    assert.ok(fs.readdirSync(dir).some((name) => name.startsWith("store.json.corrupt-")));
  } finally {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
