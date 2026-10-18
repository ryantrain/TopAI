# Agent Exchange

Agent Exchange compares three AI workers—Atlas, Nova, and Orbit—on your own worksheets and benchmark criteria. Upload material, describe the task, review the criteria, and compare accuracy, token efficiency, response time, and optional cost estimates. A virtual market visualizes each round through five seeded trading strategies.

The frontend uses Next.js 16, React 19, Tailwind CSS 4, and Recharts. The backend uses FastAPI, with SQLite by default and optional PostgreSQL storage. This is a local, single-process research prototype with one shared session and no authentication or user isolation.

## Run locally

Run commands from the repository root. Install Node.js 20.9+ and Python 3.11+. Demo rounds need no provider credentials or Ollama; drafting criteria, converting documents, and live inference have the model requirements described below.

### macOS

Install Node.js and Python if needed. If you use Homebrew:

```bash
brew install node python@3.11
```

Install dependencies and start the backend:

```bash
npm ci
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

If you already have a supported Python version, use its executable instead of `python3.11`. For local inference or benchmark drafting, install the macOS Ollama app from [Ollama](https://ollama.com/), open it, and download the model in a separate terminal:

```bash
ollama pull qwen2.5:7b
```

### Linux

With Node.js 20.9+ and Python 3.11+ installed:

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Install your distribution's Python venv package if creating the environment fails. For local inference, install Ollama separately, run its server, and pull the configured models.

### Windows PowerShell

With Node.js 20.9+ and Python 3.11+ installed:

```powershell
npm ci
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt
Copy-Item .env.example .env
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Use the launcher version for your installed Python if different. For local inference, install and start Ollama for Windows, then run `ollama pull qwen2.5:7b`.

### Start the frontend

Keep the backend running. In a second terminal, from the repository root:

```bash
npm run dev
```

Open [Agent Exchange](http://127.0.0.1:3000). Select **Demo simulation** and press **Run 1 round** for a credential-free simulation using generated math. FastAPI's interactive reference is at [API docs](http://127.0.0.1:8000/docs).

Next.js proxies `/api/*` to `http://127.0.0.1:8000`. Set `BACKEND_URL` in the frontend environment to override it. For a production frontend build, use `npm run build` followed by `npm start`; the Python backend still runs separately. Run one backend process, without multiple Uvicorn workers.

## Compare models on your material

1. Under **Your niche. Your benchmark.**, upload one or more worksheets. The app saves and selects them in the worksheet menu next to **Run**.
2. Select enough worksheets for at least 20 distinct questions. Selected worksheets are interleaved and duplicate questions are removed.
3. Describe your task, such as “Find the best model for solving first-year integration problems.” Click **Build benchmark from my request** to draft criteria through local Ollama, or fill in the criteria manually.
4. Review the evaluation method, tolerance or rubric, and click **Save benchmark criteria**. Saving requires an active dataset and a task description.
5. Choose **Live · AI models** to measure real configured workers, or keep **Demo simulation** for simulated results. Choose 1–10 rounds and run.
6. Inspect the comparison chart, fastest model meeting your minimum accuracy, worker answers, verdict reasons, and diagnostic measurements.

Each round uses one fresh batch of **20 questions by default**, shared by all three workers. There is no separate holdout stage: trading and settlement use that same batch's score. The API execution plan supports `batch_size` from 1–50 and `repetitions` from 1–5; the current form does not expose those settings. A dataset supports only complete batches: 100 questions at batch size 20 gives five rounds; 99 gives four, leaving 19 unused.

Workers receive questions and task instructions, never the reference answers. Demo answers, timings, and token counts are seeded simulations. Without uploaded data, demo uses generated math and live uses the GSM8K test split, fetched over the network.

Dataset selection, criteria, and mode are fixed after a session starts running rounds. **New session** clears the active session and selection while retaining completed-round archives and saved worksheets. **Forget** removes a saved worksheet.

## Worksheets and datasets

The worksheet uploader accepts PDFs, photos, `.docx`, `.xlsx`, `.pptx`, and UTF-8 text, including structured question/answer files. Each upload is limited to 10 MB; the library holds up to 50 worksheets, and a combined benchmark is limited to 2,000 questions.

Structured CSV, JSON, or JSONL question/answer files are imported directly when recognized. Other documents are converted through Gemini, using `GEMINI_CONVERT_MODEL` or the default Gemini model. Missing Gemini credentials or HTTP 429 responses fall back to local `OLLAMA_MODEL`. Local PDF conversion extracts text; scanned PDFs require Gemini or page images with an installed vision model. The default `qwen2.5:7b` is not a vision model.

Conversion uses the worksheet's answer key where available; otherwise the model solves the questions. The upload result reports how many answers were inferred. Check those answers before treating them as references.

For a curated dataset, use `question` and `answer` fields. A JSON object may also supply shared instructions and numeric tolerance:

```json
{
  "instructions": "Solve each definite integral. Return only the final numeric value.",
  "tolerance": 0.000001,
  "examples": [
    {"question": "Evaluate the integral from 0 to 1 of 2x dx.", "answer": 1},
    {"question": "Evaluate the integral from 0 to pi of sin(x) dx.", "answer": 2}
  ]
}
```

This illustrates the format; supply at least 20 distinct questions for a runnable benchmark. The direct `POST /api/dataset` importer accepts UTF-8 CSV, JSON, and JSONL, with 20–2,000 examples and a 2 MB limit. It rejects duplicate questions after normalizing case and whitespace. Shared JSON instructions are limited to 30,000 characters. Symbolic LaTeX integral datasets are recognized and receive mathematical-equivalence rubric criteria automatically.

## Model configuration

Edit the repository-root `.env` copied from `.env.example`, then restart the backend. Exactly three worker providers are required, in Atlas/Nova/Orbit order. Supported providers are `openai`, `gemini`, `anthropic`, and `ollama`; blank worker model entries use provider defaults.

The checked-in defaults use `openai,gemini,openai` workers. Set the corresponding credentials for live calls. Gemini is also the preferred evaluator, so choose a different worker provider/model if you want to avoid self-evaluation.

For three local workers and local fallback grading:

```dotenv
WORKER_PROVIDERS=ollama,ollama,ollama
WORKER_MODELS=qwen2.5:7b,llama3.1:8b,mistral:7b
OLLAMA_MODEL=qwen2.5:7b
GEMINI_API_KEY=
DATABASE_URL=
```

Install each model first:

```bash
ollama pull qwen2.5:7b
ollama pull llama3.1:8b
ollama pull mistral:7b
```

Ollama must listen on `http://127.0.0.1:11434`. Local requests are serialized to avoid accelerator contention; model loading and queueing affect timing. Choose models that fit your hardware. The app rejects cloud-named models on its local provider path. To disable Ollama's own cloud features, configure `OLLAMA_NO_CLOUD=1` in the Ollama server environment and restart that server; setting it only in this app's `.env` does not configure an already-running server.

To prefer hosted grading, set `GEMINI_API_KEY` and `GEMINI_MODEL` as shown in `.env.example`. Missing keys and HTTP 429 responses fall back to `OLLAMA_MODEL`. OpenAI and Anthropic workers use `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. Credentials stay in the backend; live worker and grading calls can incur provider charges.

## Evaluation and metrics

For live runs with saved criteria, Gemini grades each worker's entire batch in one call per attempt, with local Ollama fallback. One default round makes three worker calls and three evaluator calls. Repetitions multiply both counts. Criteria describe exact answers, numeric agreement, structured JSON, or a rubric; these planned methods use model verdicts rather than deterministic comparisons. The exception is **Count distinct generated items**, which counts nonempty strings in Python after normalizing case and whitespace; it measures quantity and format, not quality or originality.

Without a saved plan, runs compare numeric or exact answers directly in Python. Demo scoring stays simulated. Some UI help text still describes older scoring and holdout behavior; the runner behavior above is current.

The dashboard reports:

- Accuracy or item-format pass rate, plus submitted and reference answers.
- Correct answers—or distinct items—per 1,000 provider-reported tokens.
- Batch worker response seconds per attempted question, including provider/network latency.
- A relative overall score: 100 times the geometric mean of efficiency relative to the best worker and throughput relative to the best worker.
- The fastest worker meeting the selected minimum accuracy, including ties.
- Repeat agreement, and numeric valid-answer count, mean absolute error, and signed bias where applicable.

Only matched batches with valid timing and token measurements for every worker enter comparisons. Measurements update after each graded batch; evaluator usage and latency are excluded. Provider tokenizers differ, and pooled summaries can differ from individual chart points.

Optional `WORKER_COST_PER_1K_TOKENS=0.001,0.002,0.003` supplies blended USD estimates in worker order. These are operator-entered rates, not provider invoices. Blank means unknown, zero means free; demo and unpriced batches show no dollar estimate. Start a new session after changing rates.

Model verdicts are estimates. Review inferred references and calibrate grading against human judgments. Rankings describe the selected dataset, criteria, lineup, and run conditions.

## Storage, market, and receipts

Default files live under `backend/`: `market.sqlite3` stores shareable state/history, `market.local.json` stores full active state, and `worksheets.local.json` stores saved worksheets. `EXCHANGE_DB` changes the SQLite path and the directory used for the local JSON files.

Set `DATABASE_URL` to use TigerData/PostgreSQL for shareable state and completed-round archives (`exchange_market` and `exchange_rounds`). Uploaded questions, reference answers, and derived worker responses remain in local files and are stripped from the shared database copy. Switching database backends does not migrate existing history. Live inference and document conversion still send relevant material to their configured model providers.

Five seeded trading strategies react to benchmark scores without model calls. Shares settle at `10 + accuracy percentage` using the score already visible to traders, so virtual P&L carries no forecasting evidence. This market is a visualization separate from the model metrics.

After settlement, an optional Phantom-signed Solana Devnet memo publishes a round hash as an audit receipt. It does not run evaluation or transfer tokens.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/market` | Active session, configuration, worksheet summaries |
| POST | `/api/rounds` | Start 1–10 rounds with `{"mode":"demo","rounds":1}` or `live` |
| POST | `/api/reset` | New active session |
| GET | `/api/history` | Completed-round archives |
| POST | `/api/benchmark/suggest` | Draft criteria from a goal using Ollama |
| PUT | `/api/benchmark` | Validate and save criteria |
| POST / DELETE | `/api/dataset` | Import or remove the active dataset |
| POST | `/api/library/convert` | Import/convert and save a worksheet |
| PUT | `/api/library/selection` | Select saved worksheet IDs |
| GET / DELETE | `/api/library/{file_id}` | Export or forget a worksheet |
| GET / POST | `/api/receipt` | Prepare or verify a Devnet receipt |

See the running [FastAPI reference](http://127.0.0.1:8000/docs) for request schemas. The [dynamic benchmark notes](DYNAMIC_BENCHMARKS.md) describe execution-plan fields in more depth, but include older UI and pipeline descriptions; use this README and the current API schemas for setup and round behavior.

## Verification

On macOS/Linux:

```bash
.venv/bin/python -m unittest discover -s backend -p 'test_*.py' -v
node --test app/*.test.mjs
npm run build
```

On Windows PowerShell:

```powershell
.venv\Scripts\python -m unittest discover -s backend -p 'test_*.py' -v
Get-ChildItem app/*.test.mjs | ForEach-Object { node --test $_.FullName }
npm run build
```

Tests mock external services. Real provider calls, local inference, PostgreSQL connectivity, and Phantom/Devnet receipts need separate integration checks.
