"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../src/app");

const START = 1_800_000_000_000;
const STARTING_BALANCE = 100000;

/** Starts the API on a random port with a fake clock and a fixed crash point (default 2.00x). */
async function withApi({ crashPoint = 200, wallet } = {}, run) {
  let now = START;
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const app = createApp({ clock: clock.now, generateCrashPoint: () => crashPoint, wallet });
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
  const start = (stake, key = randomUUID()) => call("POST", "/games/crash/start", { stake }, { "Idempotency-Key": key });
  const cashout = (roundId, extra = {}) => call("POST", "/games/crash/cashout", { roundId, ...extra });
  const balance = async () => (await call("GET", "/wallet")).body.data.balance;

  try {
    await run({ base, call, start, cashout, balance, clock });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("health and games endpoints respond", () =>
  withApi({}, async ({ call }) => {
    const health = await call("GET", "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.success, true);

    const games = await call("GET", "/games");
    assert.deepEqual(games.body.data.map((g) => g.id), ["crash", "plinko", "mines", "dice"]);
    assert.equal(games.body.data[0].available, true);
  }));

test("start debits the stake and hides the crash point while running", () =>
  withApi({}, async ({ start, call, balance }) => {
    const res = await start(1000);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.round.status, "RUNNING");
    assert.equal(res.body.data.round.currentMultiplierX100, 100);
    assert.equal(res.body.data.balance, STARTING_BALANCE - 1000);
    assert.equal(await balance(), STARTING_BALANCE - 1000);

    const polled = await call("GET", `/games/crash/rounds/${res.body.data.round.roundId}`);
    for (const body of [res.body, polled.body]) {
      const text = JSON.stringify(body);
      assert.ok(!text.includes("crashMultiplierX100") && !text.includes("durationMs") && !text.includes("crashX100"));
    }
  }));

test("cash-out before the crash credits stake x server multiplier once", () =>
  withApi({}, async ({ start, cashout, balance, clock }) => {
    const { roundId } = (await start(1000)).body.data.round;
    clock.advance(5000); // 1.34x

    // Client-supplied values are ignored.
    const first = await cashout(roundId, { multiplierX100: 100000, virtualReturn: 99999999 });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.round.status, "CASHED_OUT");
    assert.equal(first.body.data.round.cashoutMultiplierX100, 134);
    assert.equal(first.body.data.round.crashMultiplierX100, 200);
    assert.equal(first.body.data.round.virtualReturn, 1340);
    assert.equal(first.body.data.alreadySettled, false);
    assert.equal(await balance(), STARTING_BALANCE - 1000 + 1340);

    clock.advance(1000);
    const again = await cashout(roundId);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.alreadySettled, true);
    assert.equal(again.body.data.round.virtualReturn, 1340);
    assert.equal(await balance(), STARTING_BALANCE - 1000 + 1340);
  }));

test("cash-out after the crash is rejected and the stake is lost", () =>
  withApi({}, async ({ start, cashout, call, balance, clock }) => {
    const { roundId } = (await start(1000)).body.data.round;
    clock.advance(11553); // exactly when 2.00x is reached

    const res = await cashout(roundId);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "ROUND_CRASHED");
    assert.equal(res.body.error.details.round.status, "CRASHED");
    assert.equal(res.body.error.details.round.crashMultiplierX100, 200);
    assert.equal(res.body.error.details.round.virtualReturn, 0);
    assert.equal(await balance(), STARTING_BALANCE - 1000);

    const history = await call("GET", "/history");
    assert.equal(history.body.data[0].outcomeSummary, "Crashed at 2.00x");
    assert.equal(history.body.data[0].completedAt, new Date(START + 11553).toISOString());
  }));

test("cash-out one millisecond before the crash still wins", () =>
  withApi({}, async ({ start, cashout, clock }) => {
    const { roundId } = (await start(1000)).body.data.round;
    clock.advance(11552);
    const res = await cashout(roundId);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.round.cashoutMultiplierX100, 199);
  }));

test("a 1.00x crash point busts immediately", () =>
  withApi({ crashPoint: 100 }, async ({ start, cashout }) => {
    const res = await start(500);
    assert.equal(res.body.data.round.status, "CRASHED");
    assert.equal((await cashout(res.body.data.round.roundId)).status, 409);
  }));

test("the same Idempotency-Key never debits twice", () =>
  withApi({}, async ({ start, balance }) => {
    const key = randomUUID();
    const first = await start(1000, key);
    const replay = await start(1000, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get("idempotent-replayed"), "true");
    assert.equal(replay.body.data.round.roundId, first.body.data.round.roundId);
    assert.equal(await balance(), STARTING_BALANCE - 1000);

    const reused = await start(2000, key);
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await balance(), STARTING_BALANCE - 1000);
  }));

test("only one round can run at a time, even with concurrent starts", () =>
  withApi({}, async ({ start, balance }) => {
    const results = await Promise.all([start(1000), start(1000), start(1000)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.error.code === "ROUND_IN_PROGRESS"));
    assert.equal(await balance(), STARTING_BALANCE - 1000);
  }));

test("a new round can start once the previous one ends", () =>
  withApi({}, async ({ start, cashout, clock }) => {
    const first = (await start(1000)).body.data.round.roundId;
    assert.equal((await start(1000)).status, 409);
    clock.advance(20000); // crashed
    assert.equal((await start(1000)).status, 201);
    assert.equal((await cashout(first)).body.error.code, "ROUND_CRASHED");
  }));

test("invalid stakes and keys are rejected without touching the wallet", () =>
  withApi({}, async ({ call, start, balance }) => {
    for (const stake of [0, -5, 1.5, "100", 9, 100001, null]) {
      const res = await start(stake);
      assert.equal(res.status, 400, `stake ${JSON.stringify(stake)}`);
      assert.ok(["INVALID_STAKE", "STAKE_OUT_OF_RANGE"].includes(res.body.error.code));
    }
    const missingStake = await call("POST", "/games/crash/start", {}, { "Idempotency-Key": randomUUID() });
    assert.equal(missingStake.status, 400);

    const noKey = await call("POST", "/games/crash/start", { stake: 100 });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error.code, "INVALID_IDEMPOTENCY_KEY");

    assert.equal(await balance(), STARTING_BALANCE);
  }));

test("insufficient balance is rejected and no round is created", () =>
  withApi({ wallet: { startingBalance: 500 } }, async ({ start, balance, call }) => {
    const res = await start(1000);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "INSUFFICIENT_BALANCE");
    assert.equal(await balance(), 500);
    assert.equal((await call("GET", "/history")).body.data.length, 0);
    assert.equal((await start(500)).status, 201);
    assert.equal(await balance(), 0);
  }));

test("unknown and malformed round IDs are rejected", () =>
  withApi({}, async ({ cashout, call }) => {
    assert.equal((await cashout(randomUUID())).status, 404);
    assert.equal((await cashout("not-a-uuid")).status, 400);
    assert.equal((await cashout(undefined)).status, 400);
    assert.equal((await call("GET", `/games/crash/rounds/${randomUUID()}`)).status, 404);
  }));

test("malformed JSON gets a JSON 400", () =>
  withApi({}, async ({ base, balance }) => {
    const res = await fetch(`${base}/games/crash/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "abcdefgh-1234" },
      body: "{ stake: 100",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "INVALID_JSON");
    assert.equal(await balance(), STARTING_BALANCE);
  }));

test("ledger entries always add up to the balance", () =>
  withApi({}, async ({ start, cashout, call, clock }) => {
    const a = (await start(1000)).body.data.round.roundId;
    clock.advance(3000);
    await cashout(a);
    await start(2500);
    clock.advance(30000);

    const wallet = (await call("GET", "/wallet")).body.data;
    const sum = wallet.recentTransactions.reduce((total, t) => total + t.amount, 0);
    assert.equal(sum, wallet.balance);
    assert.deepEqual(
      wallet.recentTransactions.map((t) => t.type),
      ["STAKE_DEBIT", "ROUND_RETURN", "STAKE_DEBIT", "STARTER_GRANT"],
    );

    const history = (await call("GET", "/history")).body.data;
    assert.deepEqual(history.map((r) => r.status), ["CRASHED", "CASHED_OUT"]);
    assert.equal((await call("GET", "/history?limit=0")).status, 400);
  }));

test("unknown routes return JSON 404", () =>
  withApi({}, async ({ call }) => {
    const res = await call("GET", "/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  }));
