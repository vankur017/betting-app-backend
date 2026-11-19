# Backend — Betting Game MVP API

Node.js + Express 5. Virtual coins only. No authentication: every request acts for one demo player (`demo-player`).

> **Storage is in memory for now.** Balance, rounds and history reset when the server restarts.
> PostgreSQL + Prisma come in Phase 3 (see `REQUIREMENTS.md`).

## Run

```bash
npm install
cp .env.example .env   # optional
npm run dev            # http://localhost:5000
npm test               # Node built-in test runner, no extra dependencies
```

Postman: import `postman/betting-game-crash.postman_collection.json`.

## Conventions

- **Amounts** are integers in minor units. 2 decimals: `1000` = 10.00 VC. Default starting balance: `100000` (1,000.00 VC).
- **Multipliers** are integers in hundredths: `100` = 1.00x, `213` = 2.13x.
- **Success:** `{ "success": true, "data": ... }`
- **Error:** `{ "success": false, "error": { "code", "message", "details"? } }`

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | |
| GET | `/api/games` | Games, `available` flag, stake limits |
| GET | `/api/wallet` | Balance and 10 most recent ledger entries |
| GET | `/api/history?limit=20` | Recent rounds, newest first (1–100) |
| POST | `/api/games/crash/start` | Body `{ "stake": 1000 }`. **Header `Idempotency-Key` required** |
| POST | `/api/games/crash/cashout` | Body `{ "roundId": "..." }` |
| GET | `/api/games/crash/rounds/:roundId` | Poll a round's state |

### Crash flow

1. `start` debits the stake and returns a `RUNNING` round with `startedAt`, `serverTime`, `elapsedMs`,
   `currentMultiplierX100` and `curve.growthPerMs`. The crash point is **not** included.
2. The client animates `multiplier = e^(growthPerMs × elapsedMs)` and polls `GET /rounds/:roundId`
   (about every 250 ms) to learn when the round crashes.
3. `cashout` settles at the multiplier for the **server's** current time. Any multiplier or amount
   in the request body is ignored.
4. Once a round ends, responses include `crashMultiplierX100`, `cashoutMultiplierX100`,
   `virtualReturn`, `outcomeSummary` and `completedAt`.

### Crash rules

- Crash point: CSPRNG (`crypto.randomInt`). `crash = 0.99 / (1 − u)`, floored to 0.01x and capped at 1000.00x,
  so `P(crash ≥ m) = 0.99 / m`. About 1% of rounds bust at 1.00x. See `src/games/crash/crash.rules.js`.
- Multiplier: `floor(100 × e^(0.00006 × elapsedMs))`, so 2.00x after about 11.6 s.
- Return: `floor(stake × multiplier)`, integer math.
- Stake: 10 to 100000 minor units (0.10 to 1,000.00 VC). Config lives in `src/config/games.js`.
- One running Crash round at a time.

### Error codes

| Code | Status | When |
| --- | --- | --- |
| `INVALID_STAKE`, `STAKE_OUT_OF_RANGE` | 400 | Stake not an integer, or outside the limits |
| `INVALID_IDEMPOTENCY_KEY` | 400 | Missing or malformed `Idempotency-Key` |
| `INVALID_ROUND_ID`, `INVALID_LIMIT`, `INVALID_JSON` | 400 | Bad input |
| `ROUND_NOT_FOUND` | 404 | |
| `ROUND_IN_PROGRESS` | 409 | A Crash round is already running (`details.roundId`) |
| `ROUND_CRASHED` | 409 | Cash-out too late (`details.round` shows the crash point) |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different stake |
| `INSUFFICIENT_BALANCE` | 422 | |

### Duplicate protection

- The same `Idempotency-Key` with the same stake returns the original round (`Idempotent-Replayed: true`) and does not debit again.
- A repeat cash-out returns the existing result with `alreadySettled: true` and credits nothing.
- The ledger allows one stake debit and one return per round.

## Structure

```
src/
  app.js, server.js
  config/        env and game config
  routes/        endpoints
  controllers/   HTTP mapping only
  services/      wallet, idempotency, crash orchestration, history
  games/crash/   pure crash rules
  store/         in-memory data (replaced by Prisma in Phase 3)
  middleware/    404 and error handler
  utils/
test/            node:test unit and API tests
postman/         Postman collection
```
