"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../src/app");

const START = 1_800_000_000_000;
const STARTING_BALANCE = 100000;

/** Starts the API with fixed outcomes. Defaults: Plinko lands in the middle, dice rolls 49.99, mines on tiles 0-2. */
async function withApi(overrides, run) {
  let now = START;
  const outcomes = {
    plinkoPath: (rows) => Array.from({ length: rows }, (_, i) => i % 2),
    diceRoll: () => 4999,
    minePositions: () => [0, 1, 2],
    ...overrides,
  };
  const app = createApp({
    clock: () => now,
    generatePlinkoPath: (rows) => outcomes.plinkoPath(rows),
    generateDiceRoll: () => outcomes.diceRoll(),
    generateMinePositions: (tileCount, mineCount) => outcomes.minePositions(tileCount, mineCount),
  });
  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  }
  const post = (path, body, key = randomUUID()) => call("POST", path, body, { "Idempotency-Key": key });
  const balance = async () => (await call("GET", "/wallet")).body.data.balance;

  try {
    await run({ call, post, balance, advance: (ms) => { now += ms; } });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("games list exposes settings for every game", () =>
  withApi({}, async ({ call }) => {
    const games = (await call("GET", "/games")).body.data;
    const byId = Object.fromEntries(games.map((g) => [g.id, g]));
    assert.deepEqual(byId.plinko.settings.rows, [8, 12, 16]);
    assert.equal(byId.mines.settings.tileCount, 25);
    assert.equal(byId.dice.settings.rollSpan, 10000);
    assert.ok(games.every((g) => g.available === true), "every game is playable");
  }));

// ---- Plinko ----

test("plinko: play settles in one request and returns the path", () =>
  withApi({}, async ({ post, call, balance }) => {
    const res = await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "low" });
    assert.equal(res.status, 201);
    const round = res.body.data.round;
    assert.equal(round.status, "SETTLED");
    assert.deepEqual(round.path, [0, 1, 0, 1, 0, 1, 0, 1]);
    assert.equal(round.bucket, 4);
    assert.equal(round.multiplierX100, 50);
    assert.equal(round.virtualReturn, 500);
    assert.equal(res.body.data.balance, STARTING_BALANCE - 1000 + 500);
    assert.equal(await balance(), STARTING_BALANCE - 500);

    const fetched = await call("GET", `/games/plinko/rounds/${round.roundId}`);
    assert.equal(fetched.body.data.round.bucket, 4);
  }));

test("plinko: edge bucket pays the table maximum", () =>
  withApi({ plinkoPath: (rows) => Array(rows).fill(1) }, async ({ post }) => {
    const res = await post("/games/plinko/play", { stake: 1000, rows: 16, risk: "high" });
    assert.equal(res.body.data.round.bucket, 16);
    assert.equal(res.body.data.round.virtualReturn, 61000);
  }));

test("plinko: rejects unsupported rows and risk, including prototype keys", () =>
  withApi({}, async ({ post, balance }) => {
    assert.equal((await post("/games/plinko/play", { stake: 1000, rows: 10, risk: "low" })).body.error.code, "INVALID_ROWS");
    assert.equal((await post("/games/plinko/play", { stake: 1000, rows: "8", risk: "low" })).body.error.code, "INVALID_ROWS");
    assert.equal((await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "extreme" })).body.error.code, "INVALID_RISK");
    assert.equal((await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "constructor" })).body.error.code, "INVALID_RISK");
    assert.equal(await balance(), STARTING_BALANCE);
  }));

test("plinko: the same Idempotency-Key replays without a second debit", () =>
  withApi({}, async ({ post, balance }) => {
    const key = randomUUID();
    const first = await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "low" }, key);
    const again = await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "low" }, key);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.equal(again.body.data.round.roundId, first.body.data.round.roundId);
    assert.equal(await balance(), STARTING_BALANCE - 500);

    const reused = await post("/games/plinko/play", { stake: 1000, rows: 12, risk: "low" }, key);
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUSED");
  }));

// ---- Dice ----

test("dice: winning roll under the target pays stake x multiplier", () =>
  withApi({ diceRoll: () => 4999 }, async ({ post, balance }) => {
    const res = await post("/games/dice/roll", { stake: 1000, target: 5000, direction: "under" });
    assert.equal(res.status, 201);
    const round = res.body.data.round;
    assert.equal(round.status, "WON");
    assert.equal(round.won, true);
    assert.equal(round.roll, 4999);
    assert.equal(round.winChanceBps, 5000);
    assert.equal(round.multiplierX100, 198);
    assert.equal(round.virtualReturn, 1980);
    assert.equal(await balance(), STARTING_BALANCE + 980);
  }));

test("dice: losing roll returns nothing", () =>
  withApi({ diceRoll: () => 5000 }, async ({ post, balance }) => {
    const res = await post("/games/dice/roll", { stake: 1000, target: 5000, direction: "under" });
    assert.equal(res.body.data.round.status, "LOST");
    assert.equal(res.body.data.round.virtualReturn, 0);
    assert.equal(await balance(), STARTING_BALANCE - 1000);
  }));

test("dice: over wins only above the target", () =>
  withApi({ diceRoll: () => 9900 }, async ({ post }) => {
    const res = await post("/games/dice/roll", { stake: 1000, target: 9899, direction: "over" });
    assert.equal(res.body.data.round.status, "WON");
    assert.equal(res.body.data.round.multiplierX100, 9900);
    assert.equal(res.body.data.round.virtualReturn, 99000);
  }));

test("dice: rejects bad direction and targets outside 1%-98% win chance", () =>
  withApi({}, async ({ post, balance }) => {
    assert.equal((await post("/games/dice/roll", { stake: 1000, target: 5000, direction: "sideways" })).body.error.code, "INVALID_DIRECTION");
    assert.equal((await post("/games/dice/roll", { stake: 1000, target: 50.5, direction: "under" })).body.error.code, "INVALID_TARGET");
    const low = await post("/games/dice/roll", { stake: 1000, target: 99, direction: "under" });
    assert.equal(low.body.error.code, "TARGET_OUT_OF_RANGE");
    assert.equal(low.body.error.details.minTarget, 100);
    assert.equal((await post("/games/dice/roll", { stake: 1000, target: 9801, direction: "under" })).body.error.code, "TARGET_OUT_OF_RANGE");
    assert.equal((await post("/games/dice/roll", { stake: 1000, target: 9900, direction: "over" })).body.error.code, "TARGET_OUT_OF_RANGE");
    assert.equal(await balance(), STARTING_BALANCE);
  }));

// ---- Mines ----

test("mines: start hides mines; safe reveals raise the multiplier; cash-out settles", () =>
  withApi({}, async ({ post, call, balance }) => {
    const started = await post("/games/mines/start", { stake: 1000, mineCount: 3 });
    assert.equal(started.status, 201);
    const round = started.body.data.round;
    assert.equal(round.status, "RUNNING");
    assert.equal(round.minePositions, undefined);
    assert.equal(round.currentMultiplierX100, 100);
    assert.equal(round.nextMultiplierX100, 112);
    assert.equal(started.body.data.balance, STARTING_BALANCE - 1000);

    const r1 = await call("POST", "/games/mines/reveal", { roundId: round.roundId, tile: 5 });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.data.round.currentMultiplierX100, 112);
    assert.equal(r1.body.data.round.minePositions, undefined);

    const repeat = await call("POST", "/games/mines/reveal", { roundId: round.roundId, tile: 5 });
    assert.equal(repeat.body.data.alreadyRevealed, true);
    assert.equal(repeat.body.data.round.safeReveals, 1);

    const r2 = await call("POST", "/games/mines/reveal", { roundId: round.roundId, tile: 6 });
    assert.equal(r2.body.data.round.currentMultiplierX100, 128);
    assert.equal(r2.body.data.round.potentialReturn, 1280);

    const active = await call("GET", "/games/mines/active");
    assert.equal(active.body.data.round.roundId, round.roundId);

    const cashed = await call("POST", "/games/mines/cashout", { roundId: round.roundId });
    assert.equal(cashed.body.data.round.status, "CASHED_OUT");
    assert.equal(cashed.body.data.round.virtualReturn, 1280);
    assert.deepEqual(cashed.body.data.round.minePositions, [0, 1, 2]);
    assert.equal(await balance(), STARTING_BALANCE + 280);

    const again = await call("POST", "/games/mines/cashout", { roundId: round.roundId });
    assert.equal(again.body.data.alreadySettled, true);
    assert.equal(await balance(), STARTING_BALANCE + 280);

    assert.equal((await call("GET", "/games/mines/active")).body.data.round, null);
  }));

test("mines: revealing a mine busts the round and reveals the board", () =>
  withApi({}, async ({ post, call, balance }) => {
    const { roundId } = (await post("/games/mines/start", { stake: 1000, mineCount: 3 })).body.data.round;
    const hit = await call("POST", "/games/mines/reveal", { roundId, tile: 1 });
    assert.equal(hit.status, 200);
    assert.equal(hit.body.data.round.status, "BUSTED");
    assert.equal(hit.body.data.round.hitMine, 1);
    assert.deepEqual(hit.body.data.round.minePositions, [0, 1, 2]);
    assert.equal(await balance(), STARTING_BALANCE - 1000);

    const late = await call("POST", "/games/mines/reveal", { roundId, tile: 9 });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, "ROUND_ENDED");
    assert.equal((await call("POST", "/games/mines/cashout", { roundId })).body.error.code, "ROUND_BUSTED");
  }));

test("mines: clearing every safe tile settles automatically", () =>
  withApi({ minePositions: () => Array.from({ length: 24 }, (_, i) => i + 1) }, async ({ post, call, balance }) => {
    const { roundId } = (await post("/games/mines/start", { stake: 1000, mineCount: 24 })).body.data.round;
    const res = await call("POST", "/games/mines/reveal", { roundId, tile: 0 });
    assert.equal(res.body.data.round.status, "CASHED_OUT");
    assert.equal(res.body.data.round.cashoutMultiplierX100, 2475);
    assert.equal(await balance(), STARTING_BALANCE - 1000 + 24750);
  }));

test("mines: one running round at a time, no cash-out before a reveal, input checks", () =>
  withApi({}, async ({ post, call, balance }) => {
    assert.equal((await post("/games/mines/start", { stake: 1000, mineCount: 0 })).body.error.code, "INVALID_MINE_COUNT");
    assert.equal((await post("/games/mines/start", { stake: 1000, mineCount: 25 })).body.error.code, "INVALID_MINE_COUNT");

    const { roundId } = (await post("/games/mines/start", { stake: 1000, mineCount: 3 })).body.data.round;
    const second = await post("/games/mines/start", { stake: 1000, mineCount: 3 });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, "ROUND_IN_PROGRESS");
    assert.equal(second.body.error.details.roundId, roundId);

    const early = await call("POST", "/games/mines/cashout", { roundId });
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, "NO_SAFE_REVEALS");

    assert.equal((await call("POST", "/games/mines/reveal", { roundId, tile: 25 })).body.error.code, "INVALID_TILE");
    assert.equal((await call("POST", "/games/mines/reveal", { roundId, tile: "3" })).body.error.code, "INVALID_TILE");
    assert.equal((await call("POST", "/games/mines/reveal", { roundId: "nope", tile: 3 })).body.error.code, "INVALID_ROUND_ID");
    assert.equal(await balance(), STARTING_BALANCE - 1000);
  }));

// ---- Shared ----

test("history lists rounds from every game, newest first", () =>
  withApi({}, async ({ post, call }) => {
    await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "low" });
    await post("/games/dice/roll", { stake: 1000, target: 5000, direction: "under" });
    await post("/games/mines/start", { stake: 1000, mineCount: 3 });
    const history = (await call("GET", "/history")).body.data;
    assert.deepEqual(history.map((r) => r.game), ["mines", "dice", "plinko"]);
    assert.equal(history[0].status, "RUNNING");
  }));

test("history can be filtered to one game", () =>
  withApi({}, async ({ post, call }) => {
    await post("/games/plinko/play", { stake: 1000, rows: 8, risk: "low" });
    await post("/games/dice/roll", { stake: 1000, target: 5000, direction: "under" });
    await post("/games/plinko/play", { stake: 1000, rows: 12, risk: "high" });
    const plinko = (await call("GET", "/history?game=plinko")).body.data;
    assert.deepEqual(plinko.map((r) => r.game), ["plinko", "plinko"]);
    const bad = await call("GET", "/history?game=poker");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "INVALID_GAME");
  }));

test("round lookups are scoped to their game", () =>
  withApi({}, async ({ post, call }) => {
    const { roundId } = (await post("/games/dice/roll", { stake: 1000, target: 5000, direction: "under" })).body.data.round;
    assert.equal((await call("GET", `/games/plinko/rounds/${roundId}`)).status, 404);
    assert.equal((await call("GET", `/games/mines/rounds/${roundId}`)).status, 404);
    assert.equal((await call("GET", `/games/dice/rounds/${roundId}`)).status, 200);
  }));
