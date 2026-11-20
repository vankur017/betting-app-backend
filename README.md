# Backend — Betting Game MVP API

Node.js + Express 5. Virtual coins only. No authentication: every request acts for one demo player (`demo-player`).

> **Storage is a local JSON file for now** (`data/store.json`, git-ignored). Balance, ledger, rounds and
> idempotency keys survive a restart. PostgreSQL + Prisma come in Phase 3 (see `REQUIREMENTS.md`).

- The server keeps working in memory and writes a snapshot before every JSON response (temp file + rename).
- Change the path with `DATA_FILE`, or set `DATA_FILE=memory` to reset on every restart.
- **Reset the demo player:** stop the server and delete `data/store.json`.
- An unreadable file is moved to `store.json.corrupt-<timestamp>` and a fresh store starts.
- Single server process only. `DEMO_STARTING_BALANCE` applies only when the file is first created.

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
| GET | `/api/history?limit=20&game=plinko` | Recent rounds, newest first (1–100). `game` is optional |
| POST | `/api/games/crash/start` | Body `{ "stake": 1000 }`. **Header `Idempotency-Key` required** |
| POST | `/api/games/crash/cashout` | Body `{ "roundId": "..." }` |
| GET | `/api/games/crash/rounds/:roundId` | Poll a round's state |
| POST | `/api/games/plinko/play` | Body `{ "stake", "rows": 8\|12\|16, "risk": "low"\|"medium"\|"high" }`. **`Idempotency-Key` required** |
| GET | `/api/games/plinko/rounds/:roundId` | |
| POST | `/api/games/dice/roll` | Body `{ "stake", "target": 5000, "direction": "under"\|"over" }`. **`Idempotency-Key` required** |
| GET | `/api/games/dice/rounds/:roundId` | |
| POST | `/api/games/mines/start` | Body `{ "stake", "mineCount": 1-24 }`. **`Idempotency-Key` required** |
| POST | `/api/games/mines/reveal` | Body `{ "roundId", "tile": 0-24 }` |
| POST | `/api/games/mines/cashout` | Body `{ "roundId" }` |
| GET | `/api/games/mines/active` | Running Mines round or `null`, to resume after a refresh |
| GET | `/api/games/mines/rounds/:roundId` | |

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
  so `P(crash ≥ m) = 0.99 / m` for m ≥ 1.01x. About 2% of rounds end at 1.00x (values below 1.00x are raised
  to it, and 1.00x–1.01x floors to it). Players get back about 98.2–98.4% on average whatever they cash out at.
  See `src/games/crash/crash.rules.js`.
- Multiplier: `floor(100 × e^(0.00006 × elapsedMs))`, so 2.00x after about 11.6 s.
- Return: `floor(stake × multiplier)`, integer math.
- Stake: 10 to 100000 minor units (0.10 to 1,000.00 VC). Config lives in `src/config/games.js`.
- One running Crash round at a time.

### Plinko

- Instant: one request debits, picks the path, credits and stores a `SETTLED` round.
- Path: one CSPRNG left/right step per row (`path`: 0 = left, 1 = right). Bucket = number of rights.
- Return: `floor(stake × table[bucket])`. Tables (rows × risk) are original, live in `src/config/games.js`,
  are sent in `GET /api/games` under `settings`, and stay at 98.6–99.0% RTP (checked in tests).

### Dice

- Instant. Roll is 0.00–99.99, sent as hundredths (`0`–`9999`). `target` is also in hundredths.
- `under` wins when `roll < target`; `over` wins when `roll > target`. Win chance must be 1%–98%:
  `under` target 100–9800, `over` target 199–9899.
- Multiplier: `floor(9900 × 100 / winningRolls)`, e.g. 50% → 1.98x. Status `WON` or `LOST`.

### Mines

- 5×5 board (tiles `0`–`24`), 1–24 mines placed by a CSPRNG shuffle. Positions are **never** sent while `RUNNING`.
- Multiplier after k safe reveals: `floor(0.99 × C(25, k) / C(25 − mines, k))`, capped at 1,000,000.00x.
- Revealing a mine → `BUSTED`, stake lost. Revealing every safe tile cashes out automatically.
- Cash-out needs at least one safe reveal. Repeat cash-out → `alreadySettled: true`; repeat reveal of a
  safe tile → `alreadyRevealed: true`. Neither changes the balance. One running Mines round at a time.

> `available` in `GET /api/games` is `true` for all four games (`PLAYABLE` in `src/config/games.js`).

### Error codes

| Code | Status | When |
| --- | --- | --- |
| `INVALID_STAKE`, `STAKE_OUT_OF_RANGE` | 400 | Stake not an integer, or outside the limits |
| `INVALID_IDEMPOTENCY_KEY` | 400 | Missing or malformed `Idempotency-Key` |
| `INVALID_ROUND_ID`, `INVALID_LIMIT`, `INVALID_GAME`, `INVALID_JSON` | 400 | Bad input |
| `INVALID_ROWS`, `INVALID_RISK` | 400 | Plinko board setting not supported |
| `INVALID_DIRECTION`, `INVALID_TARGET`, `TARGET_OUT_OF_RANGE` | 400 | Dice bet invalid |
| `INVALID_MINE_COUNT`, `INVALID_TILE` | 400 | Mines input invalid |
| `ROUND_NOT_FOUND` | 404 | |
| `ROUND_IN_PROGRESS` | 409 | A Crash or Mines round is already running (`details.roundId`) |
| `ROUND_CRASHED` | 409 | Cash-out too late (`details.round` shows the crash point) |
| `ROUND_ENDED` | 409 | Mines reveal after the round ended |
| `ROUND_BUSTED` | 409 | Mines cash-out after hitting a mine |
| `NO_SAFE_REVEALS` | 409 | Mines cash-out before any safe reveal |
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
  store/         in-memory data + JSON file persistence (replaced by Prisma in Phase 3)
  middleware/    404 and error handler
  utils/
test/            node:test unit and API tests
postman/         Postman collection
```
