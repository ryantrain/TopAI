# Agent Exchange: Dynamic AI Evaluation

Agent Exchange helps students and teachers compare AI agents on a task they define. The current reference use case is integral mathematics: a user describes the kind of integral test or question-solving task they need, uploads a curated dataset, and runs the same experiment against three worker agents. The app scores the responses and shows which agent performed best for that task.

The benchmark pipeline is general. Integral questions are the present use case, but the same pipeline works for classification, numeric estimation, structured output, and open-ended responses, because Gemini decides correctness from the question, the agent's answer, and your reference answer rather than from a fixed comparison rule.

## How it works

```text
User goal (plain language)
   ↓
Local Ollama turns it into benchmark metrics and task instructions
   ↓
User reviews and saves the criteria + uploads the dataset
   ↓
┌─ one stage: a batch of 10 questions ─────────────────────┐
│ The batch goes to all 3 demo agents concurrently;        │
│ each agent answers all 10 in one call                    │
│   ↓                                                      │
│ Each agent's 10 answers go to Gemini in ONE call, with   │
│ the reference answers; Gemini returns correct /          │
│ not correct with a reason for each                       │
│   ↓                                                      │
│ The Python backend stores the 30 verdicts and updates    │
│ the UI graph and metrics                                 │
└──────────────────────────────────────────────────────────┘
   ↓   (a round runs two stages: 10 public, then 10 holdout)
Final accuracy, speed, token efficiency, cost estimates, and best agent
```

The planner does not create ground truth. The uploaded dataset supplies the evaluation questions and reference answers. Users review and save the generated benchmark criteria before a run.

Grading is batched on purpose, to stay inside Gemini's rate limits. One round makes **6 Gemini calls** — one per agent per stage, 10 answers each, 3 of them in flight at a time — not one call per answer. Scores and metrics therefore advance at the end of each stage, twice per round, rather than continuously; the price chart gains its points at the public stage, on each trade, and at settlement.

## Integral-test workflow

1. Describe the task in plain language, for example: `Find the best model for solving first-year integration problems. Return only the final numeric answer.`
2. Click **Build benchmark from my request**. Local Ollama converts the request into an editable set of benchmark metrics: task instructions, what counts as a correct answer, tolerance, and pass threshold.
3. Upload one UTF-8 `.json`, `.jsonl`, or `.csv` dataset containing at least 20 distinct examples.
4. Review and save the benchmark criteria.
5. Choose the worker models and run one or more rounds.
6. Each stage runs as a batch: the three agents each answer all 10 questions, Gemini grades each agent's 10 answers in a single call, and the backend stores the verdicts and updates the graph and metrics.
7. Inspect each model's answers, evaluation results, accuracy, response time, token efficiency, estimated cost, and overall ranking.

Each round uses 20 examples: 10 public questions followed by 10 unused holdout questions. Reference answers never enter worker prompts.

For numeric integral answers, a JSON dataset can look like this:

```json
{
  "instructions": "Solve each definite integral. Return only the final numeric value.",
  "tolerance": 0.000001,
  "examples": [
    {
      "question": "Evaluate the definite integral from 0 to 1 of 2x dx.",
      "answer": 1
    },
    {
      "question": "Evaluate the definite integral from 0 to pi of sin(x) dx.",
      "answer": 2
    }
  ]
}
```

Add at least 20 distinct examples. For multiple rounds, provide 20 examples per round.

## Evaluation

Gemini is the only evaluator. There are no separate judge or evaluator agents, and no per-method Python comparison. The one exception is the item-counting task, which counts distinct strings in Python because counting is not a verdict. For each answer, Gemini receives the question, the agent's answer, the reference answer, and the saved criteria, and returns a verdict with a short reason.

The saved criteria shape that verdict rather than selecting a different code path:

| Criterion | What it tells Gemini |
| --- | --- |
| Task instructions | What the agent was asked to produce |
| Tolerance | How close a numeric answer must be to count as correct |
| Pass threshold | How strict to be on open-ended or partially correct answers |

This makes evaluation flexible — equivalent phrasings, rearranged structures, and `0.5` versus `1/2` can all be accepted — and makes it a model estimate rather than a deterministic measurement. Calibrate against hand-graded examples before trusting a ranking, and do not use Gemini as one of the three demo agents.

## Run locally

Requirements:

- Node.js 20.9+
- Python 3.11+
- [Ollama](https://ollama.com/) for prompt parsing (turning the user request into benchmark metrics)
- A `GEMINI_API_KEY` for answer unpacking and grading

On macOS or Linux:

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp .env.example .env
ollama pull qwen2.5:7b
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Windows PowerShell:

```powershell
npm install
python -m venv .venv
.venv\Scripts\python -m pip install -r backend/requirements.txt
Copy-Item .env.example .env
ollama pull qwen2.5:7b
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
npm run dev
```

Open <http://127.0.0.1:3000>. Ollama must be running at `http://127.0.0.1:11434` to draft benchmark metrics from a request. `GEMINI_API_KEY` must be set for a live run with saved benchmark criteria, since Gemini decides every verdict. Demo mode never calls it.

## Model configuration

Copy `.env.example` to `.env`. Three worker slots can use OpenAI, Gemini, Anthropic, or local Ollama models. Avoid putting Gemini in a worker slot, since Gemini is the evaluator.

Evaluation always uses Gemini, so `GEMINI_API_KEY` is required even when all three demo agents are local. For local demo agents:

```dotenv
OLLAMA_MODEL=qwen2.5:7b
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.0-flash

WORKER_PROVIDERS=ollama,ollama,ollama
WORKER_MODELS=qwen2.5:7b,llama3.1:8b,mistral:7b

TRADER_PROVIDER=ollama
TRADER_MODEL=qwen2.5:7b
ANALYST_PROVIDER=ollama
ANALYST_MODEL=qwen2.5:7b

DATABASE_URL=
```

Install every configured Ollama model before starting a live run. Models containing `cloud` in their name are rejected by the local provider path.

Cloud workers can be configured with `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`. Keys remain in the Python backend and are never sent to the browser. Live runs may incur provider charges.

## Dataset rules

- Upload one file up to 2 MB.
- Accepted formats are CSV, JSON, and JSONL.
- Include 20–2,000 distinct examples with `question` and `answer` fields.
- A JSON object may also include shared `instructions`, `tolerance`, and an `examples` array.
- Dataset and benchmark criteria are locked after a run starts. Start a new session to change them.
- Only upload educational material and student work you are permitted to process.

The importer rejects duplicate questions to reduce holdout leakage. It cannot detect paraphrased duplicates or overlap between examples embedded in instructions and evaluation cases.

## Results

The dashboard reports:

- the percentage of answers Gemini marked correct;
- response time per attempted question;
- correct answers per 1,000 provider-reported tokens;
- optional estimated cost per 1,000 tokens;
- an overall relative score across the selected worker lineup;
- the underlying questions, answers, and Gemini's reason for each verdict.

These update at the end of each stage, so twice per round. Timing and token figures cover the demo agents only; Gemini's grading latency and tokens are excluded.

Results apply only to the uploaded dataset, saved criteria, configured models, Gemini's judgment, and run conditions. They are not universal model rankings. Demo mode uses seeded simulated answers, token counts, and timings and does not establish real model performance.

The existing virtual market remains an experimental visualization layer: trading agents react to public benchmark results before the holdout reveal. It is separate from the direct model-comparison metrics and should not be treated as a financial product or as evidence that a trading strategy is valid.

## Storage and optional receipts

SQLite is used by default. Set `DATABASE_URL` to a TigerData/PostgreSQL connection string to store active state and completed-round archives remotely. The backend creates `exchange_market` and `exchange_rounds`; switching storage backends does not migrate existing SQLite history.

After settlement, a user may publish a hash of the round through a Phantom-signed Solana Devnet memo. This is an optional audit receipt. It does not execute model evaluation or transfer tokens on-chain.

## API

- `GET /api/market` — current experiment state
- `POST /api/benchmark/suggest` — draft benchmark criteria from a plain-language goal
- `PUT /api/benchmark` — validate and save benchmark criteria
- `POST /api/dataset?filename=...&scoring=...` — upload a benchmark dataset
- `DELETE /api/dataset` — remove the active dataset before a run
- `POST /api/rounds` — run 1–10 experiment rounds
- `POST /api/reset` — start a new active session
- `GET /api/history` — list archived completed rounds
- `GET /api/receipt` and `POST /api/receipt` — prepare and verify an optional Solana receipt

FastAPI documentation is available at <http://127.0.0.1:8000/docs> while the backend is running.

## Verification

```bash
.venv/bin/python -m unittest backend.test_market backend.test_integrations backend.test_datasets backend.test_evaluation -v
node app/api-response.test.mjs
node app/model-metrics.test.mjs
node app/receipt-transaction.test.mjs
npm run build
```

The automated tests mock external model providers, databases, wallets, and Solana RPC calls. Real provider credentials, local Ollama models, TigerData connectivity, and Phantom/Devnet receipts require separate integration testing.

See [DYNAMIC_BENCHMARKS.md](DYNAMIC_BENCHMARKS.md) for detailed scoring behavior and local-model limitations.
