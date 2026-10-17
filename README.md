# Agent Exchange

A local autonomous stock exchange where five AI traders buy shares in three worker agents based on benchmark performance. Next.js, Tailwind, Recharts, FastAPI, Gemini, OpenAI, and SQLite or TigerData/PostgreSQL. Optional Phantom-signed Solana Devnet receipts provide verifiable records of settled rounds.

## Run locally

Node.js 20.9+ and Python 3.11+ are required. In the repository root:

```powershell
npm install
python -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
npm run dev
```

Open http://localhost:3000. Click **Run a round**. Each click runs one complete benchmark → trade → reveal → settlement cycle. Demo rounds take about six seconds; repeat for a longer presentation. The dashboard polls every 1.2 seconds. Worker cards open the actual questions, answers, and grading. Sidebar views show trader theses and the event history.

Demo mode works without credentials. It uses seeded synthetic math problems and simulated worker answers and trading strategies, explicitly labeled throughout. It is not a claim about any model's real performance. Initial prices are 60 credits; history starts empty.

## Live Gemini + OpenAI + GSM8K mode

Copy `.env.example` to `.env`, set `OPENAI_API_KEY` and `GEMINI_API_KEY`, and restart FastAPI. Use **New session** before selecting **Live**. Keys remain in Python and are never sent to the browser. Live mode incurs API costs: **12 generation requests per round** (three workers on each of two benchmarks, five independent trader requests, and one market analyst request). Each worker request contains a batch of ten questions. Timing depends on API latency and limits; 2–3 minutes is a demo target, not a guarantee.

The default lineup assigns Atlas and Orbit to OpenAI and Nova to Gemini. **Gemini powers all five trading strategies and the market analyst.** After settlement, the analyst explains results using recorded scores, orders, trader theses, and P&L; it cannot change portfolios. Commentary failures leave settlement intact. Demo commentary is a template, not an API call.

Configure `WORKER_PROVIDERS=openai,gemini,anthropic` and set `ANTHROPIC_API_KEY` to make Orbit a Claude competitor. `WORKER_MODELS` accepts three optional model overrides in Atlas/Nova/Orbit order; leaving it blank uses provider defaults. `TRADER_PROVIDER`, `TRADER_MODEL`, `ANALYST_PROVIDER`, and `ANALYST_MODEL` independently control the two Gemini roles. Defaults are configurable model IDs, not claims about relative model quality. The app uses Gemini's [generateContent JSON mode](https://ai.google.dev/api/generate-content), the OpenAI Responses API, and Claude's Messages API. The dashboard shows configured roles, missing keys, and actual providers used for worker results. Changing a live model lineup requires a new session so histories do not silently mix different configurations.

The backend downloads and caches the official [GSM8K test split](https://github.com/openai/grade-school-math) (MIT licensed) at `backend/gsm8k.jsonl` on the first live round. Permit outbound HTTPS to GitHub and configured model providers. Questions are disjoint across stages and rounds within a session; exhaustion requires a new session, which reuses the split. Workers receive questions without ground truth; traders receive only public scores, prices, and provider/model identities. The grader accepts numeric final answers and compares them to the dataset's final answer. Prompt variants differentiate workers. The OpenAI integration follows the [Responses API text guide](https://developers.openai.com/api/docs/guides/text). This MVP implements math evaluation; coding and broader reasoning benchmark suites are not implemented.

## TigerData storage

Set `DATABASE_URL` to your TigerData PostgreSQL connection string with the service's TLS settings (typically `?sslmode=require`) before starting FastAPI. Use a dedicated database or schema search path for this prototype. Credentials never appear in API responses. An unreachable configured database fails explicitly; it does not silently fall back to SQLite.

Two namespaced PostgreSQL tables are created: `exchange_market` stores the active JSONB market snapshot, and `exchange_rounds` archives full completed-round snapshots keyed by session ID and round, indexed by timestamp. Each archive contains prices, trades, score histories, model assignments, portfolios, commentary, and any verified receipt. Archives survive **New session**. These are ordinary PostgreSQL tables hosted on TigerData; hypertable conversion and Timescale-specific analytics are not required or configured for the MVP. The same archive behavior works in SQLite. Existing SQLite MVP snapshots are loaded automatically from the legacy `market` table; new writes use `exchange_market`.

Example TigerData query for worker prices from completed rounds:

```sql
SELECT r.recorded_at, r.session_id, r.round,
       worker->>'name' AS worker,
       (worker->>'price')::numeric AS redemption_price
FROM exchange_rounds AS r
CROSS JOIN LATERAL jsonb_array_elements(r.data->'workers') AS worker
ORDER BY r.recorded_at DESC;
```

Changing database backends selects a separate market; it does not migrate SQLite history into PostgreSQL. `GET /api/history` lists the latest 30 archived rounds for the selected backend.

## Solana Devnet receipts

Run a round, then open the dashboard in a browser with the Phantom extension. Fund a dedicated Devnet wallet with test SOL using the [Solana faucet](https://faucet.solana.com/). Click **Record via Phantom** and approve the memo transaction yourself. The app builds a legacy memo transaction and submits the signed bytes only to the fixed official Devnet RPC. There are no server-side wallet keys, automatic airdrops, mainnet calls, or token transfers.

After submission, click **Verify receipt** once the transaction is confirmed. This step does not request another signature. The backend independently reads the transaction from Devnet and checks its success and memo against the current settled round. It saves the signature and Explorer link only after verification. Keep the current round until verification finishes; a new round or session changes the expected receipt. If the public RPC is rate limited, retry verification. A pending signature is held in browser memory, so keep the tab open until verified.

`GET /api/receipt` exposes the canonical statement and SHA-256 digest. The statement covers session, round, mode, model configuration, public/reveal scores, executed trades, payouts, and cash balances. Only the identifying memo and hash go on-chain. The complete underlying statement is reconstructible from the archived market snapshot. This proves which simulation record was published; it does not independently verify benchmark truth or make settlement trustless.

**Scope:** Solana currently records settled-round receipts. Trades and credits still execute in Python. SPL test-token transfers, custody/escrow, an on-chain exchange program, and autonomous wallet execution are not implemented. Do not pitch this as on-chain token trading. See the [Solana memo recipe](https://github.com/solana-foundation/developer-content/blob/main/content/cookbook/transactions/add-memo.md) and [Phantom signing documentation](https://docs.phantom.com/solana/sending-a-transaction).

## Market rules

- Each trader starts with **10,000 virtual credits**.
- The public benchmark sets each opening quote to **10 + accuracy percentage** (80% → 90 credits).
- All traders decide from the same public snapshot. Execution priority rotates each round. Each submits at most three orders, with 1–30 shares per order.
- A virtual market maker supplies liquidity. Buying raises the quote by 0.20 credits/share; selling lowers it. Orders execute at the average of the starting and ending quote. Prices cannot fall below 1 credit. There is no borrowing or short selling.
- The second, unseen benchmark sets redemption value to **10 + new accuracy percentage**. All shares redeem and positions close. Profit is redemption minus execution cost. A higher score alone does not guarantee profit if the trader paid too much.
- The leaderboard uses cash + positions valued at the current quote. After settlement, it represents realized cash returns.

This is a performance-linked round contract, rather than perpetual corporate equity. The pricing and settlement rules are intentionally explicit for the MVP.

## Persistence and limits

The selected database stores the complete market snapshot, portfolios, orders, scored answers, and event history after every phase. Charts retain 200 ticks, recent orders 200, and events 100. Score and settlement histories persist for the session. **New session** clears the active market after a confirmation and retains completed-round archives.

Use one Uvicorn worker. An in-process lock coordinates rounds; this is a trusted local prototype without authentication, not a public multi-user exchange. Failed rounds restore the pre-round state; a server interruption preserves the partial snapshot but blocks further rounds until a reset. API errors are surfaced without exposing provider request details. There are no real assets or funds.

## Verify

```powershell
.venv\Scripts\python -m unittest backend.test_market -v
.venv\Scripts\python -m unittest backend.test_integrations -v
node app/receipt-transaction.test.mjs
npm run build
```

Checks cover order accounting, invalid orders, scoring, a complete demo cycle, settlement, persistence, rollback, API conflicts, Gemini's HTTP request/response contract, provider routing, ground-truth isolation, identical trader snapshots, commentary failure, archive retention, legacy loading, parameterized PostgreSQL statements, Devnet receipt binding, and signed transaction serialization. External services are mocked; no test calls paid models, writes a remote database, connects a wallet, or broadcasts a transaction. Real provider responses, TigerData connectivity, and the Phantom/Devnet confirmation flow require your own credentials and wallet for live verification.

## Four-person split

| Owner | Scope |
| --- | --- |
| Worker / benchmark | `benchmark`, `ask`, GSM8K loading and numeric grading in `backend/main.py` |
| Trading agents | `trading` and trader prompts in `backend/main.py` |
| Market / API | `execute_order`, `settle`, SQLite persistence, FastAPI routes |
| Dashboard | `app/page.js`, `app/globals.css`, Recharts |

API: `GET /api/market`, `POST /api/rounds` with `{"mode":"demo"}` or `{"mode":"live"}`, `POST /api/reset`, `GET /api/history`, `GET /api/receipt`, and `POST /api/receipt` with signature, session ID, and round. Next.js proxies `/api/*` to port 8000; override with `BACKEND_URL` if needed. FastAPI's local interactive API reference is at http://127.0.0.1:8000/docs.
