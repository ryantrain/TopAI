# Agent Exchange

Agent Exchange helps students and teachers find the best AI model for a specific task using their own material. The reference use case is integral mathematics: describe the job, upload worksheets with trusted answers, and compare up to six agents on the same questions.

The benchmark engine is general enough for numeric answers, exact labels, structured JSON, generated-item counts, and rubric-judged responses.

## Execution flow

```text
User describes the task and uploads worksheets
   ↓
Local Ollama drafts editable benchmark criteria
   ↓
App checks WORKER_PROVIDERS and their API keys
   ├─ ready: run 1–6 configured API/local agents concurrently
   └─ incomplete: run 3 seeded simulated demo agents
   ↓
Gemini evaluates each completed answer batch when GEMINI_API_KEY is set
   └─ missing or failed Gemini request: local Ollama evaluates the batch
   ↓
Python stores verdicts and updates accuracy, speed, token, cost, and chart data
   ↓
Repeat with 10 held-out questions, then recommend the best agent for this task
```

The uploaded dataset supplies the questions and reference answers. Reference answers never enter worker prompts. A round consumes 20 distinct examples: 10 public questions and 10 held-out questions.

Item counting is deterministic Python. Other saved benchmark methods use the selected AI evaluator, so their verdicts are model assessments rather than formal proofs. Users can inspect each question, response, verdict, and reason.

## Run locally

Requirements:

- Node.js 20.9+
- Python 3.11+
- [Ollama](https://ollama.com/) for benchmark planning and the evaluation fallback
- Provider API keys for real agents; without a complete agent configuration the app uses the demo fallback

On macOS or Linux:

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp .env.example .env
ollama pull qwen2.5:7b
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Windows PowerShell, use `.venv\Scripts\python` instead of `.venv/bin/python`.

In a second terminal:

```bash
npm run dev
```

Open <http://127.0.0.1:3000>. Run `ollama serve` separately if the Ollama desktop app is not already serving `http://127.0.0.1:11434`.

## Configure agents and evaluation

Copy `.env.example` to `.env`. `WORKER_PROVIDERS` accepts one to six comma-separated values from `openai`, `gemini`, `anthropic`, and `ollama`. `WORKER_MODELS` and `WORKER_COST_PER_1K_TOKENS` follow the same order.

```dotenv
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-3.8-flash

WORKER_PROVIDERS=gemini,gemini,gemini
WORKER_MODELS=gemini-3.8-flash,gemini-3.8-flash,gemini-3.8-flash
WORKER_COST_PER_1K_TOKENS=,,

TRADER_PROVIDER=gemini
ANALYST_PROVIDER=gemini
OLLAMA_MODEL=qwen2.5:7b
```

At setup, the UI reports either **API agents ready** or **Demo fallback ready**. All keys required by the configured workers, trader, and analyst must be present for an API run. If configuration is invalid or a key is missing, the UI selects the seeded demo automatically.

Evaluation follows a separate priority:

1. `GEMINI_API_KEY` present: Gemini judges answer batches.
2. If Gemini is not configured or its request fails: `OLLAMA_MODEL` judges locally.

Ollama always drafts benchmark plans. Structured CSV/JSON imports need no conversion model. PDF, photo, Word, Excel, PowerPoint, and text worksheet conversion uses Gemini, with `GEMINI_CONVERT_MODEL` falling back to `GEMINI_MODEL`.

## Use the integral benchmark

1. Add or select worksheets totaling at least 20 questions.
2. Describe the task, such as `Find the best agent for first-year indefinite integrals.`
3. Click **Suggest marking** and review the generated instructions and rubric.
4. Choose the marking method and number of quizzes.
5. Start the class. The app selects API agents or the demo fallback automatically.
6. Inspect the recommendation, result table, chart, and marked answers.

A structured dataset can be a CSV, JSON array, JSONL file, or JSON envelope:

```json
{
  "instructions": "Solve each definite integral. Return only the final numeric value.",
  "tolerance": 0.000001,
  "examples": [
    { "question": "Evaluate the integral from 0 to 1 of 2x dx.", "answer": 1 },
    { "question": "Evaluate the integral from 0 to pi of sin(x) dx.", "answer": 2 }
  ]
}
```

Provide at least 20 distinct examples and 20 more for every additional round. Imports reject exact duplicate questions, but cannot detect paraphrased leakage or inaccurate answer keys.

## Metrics

The dashboard reports:

- evaluator-marked accuracy or pass rate;
- worker time per attempted question;
- correct answers per 1,000 worker tokens;
- optional estimated worker cost;
- an overall relative score combining token efficiency and throughput;
- repeat agreement and numeric error diagnostics when applicable.

Demo timing and token counts are seeded simulation values. Evaluator latency and evaluator tokens are excluded from worker metrics. Results apply only to the uploaded data, prompt, criteria, evaluator, and model versions used in that run.

## Storage and optional receipts

SQLite is the default. Set `DATABASE_URL` to a TigerData/PostgreSQL connection string to store active state and completed-round archives remotely. Changing storage backends does not migrate existing history.

After a completed round, a user may publish its hash through a Phantom-signed Solana Devnet memo. This optional receipt records evidence of the result; it does not run evaluation or transfer tokens.

Uploaded worksheet source files remain in owner-only local storage. Cloud workers receive benchmark questions. Gemini evaluation receives questions, worker answers, references, and criteria. When Gemini is absent, Ollama evaluation stays on the local machine. Remove unnecessary personal information from student material before using cloud services.

## API and verification

Important routes:

- `GET /api/market` — state plus detected agent/evaluator configuration
- `POST /api/benchmark/suggest` and `PUT /api/benchmark` — draft and save criteria
- `POST /api/library/convert` and `PUT /api/library/selection` — import and select worksheets
- `POST /api/rounds` — run 1–10 rounds
- `POST /api/reset` — start a new session
- `GET /api/history` — archived rounds
- `GET /api/receipt` and `POST /api/receipt` — optional Solana receipt

```bash
.venv/bin/python -m unittest backend.test_market backend.test_integrations backend.test_datasets backend.test_evaluation -v
node app/api-response.test.mjs
node app/model-metrics.test.mjs
node app/receipt-transaction.test.mjs
npm run build
```

The automated suite mocks external providers, databases, wallets, and RPC calls. Real credentials and services require a separate integration run.
