"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { parseCorsOrigins } = require("../src/config/cors");
const { createApp } = require("../src/app");

test("CORS_ORIGIN parsing: default, trimming, trailing slashes", () => {
  assert.deepEqual(parseCorsOrigins(undefined), ["http://localhost:5173"]);
  assert.deepEqual(parseCorsOrigins(" http://localhost:5173 , https://my-app.vercel.app/ ,"), [
    "http://localhost:5173",
    "https://my-app.vercel.app",
  ]);
});

test("a * entry matches one name part only", () => {
  const [pattern] = parseCorsOrigins("https://my-app-*.vercel.app");
  assert.ok(pattern instanceof RegExp);
  assert.ok(pattern.test("https://my-app-git-main-ankur.vercel.app"));
  assert.ok(!pattern.test("https://evil.vercel.app"));
  assert.ok(!pattern.test("https://my-app-x.vercel.app.evil.com"));
  assert.ok(!pattern.test("https://my-app-a.b.vercel.app"));
});

test("the API answers CORS for allowed origins only", async () => {
  const app = createApp({ corsOrigins: parseCorsOrigins("https://my-app.vercel.app") });
  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/health`;
  try {
    const allowed = await fetch(base, { headers: { Origin: "https://my-app.vercel.app" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://my-app.vercel.app");
    const other = await fetch(base, { headers: { Origin: "https://other.vercel.app" } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
