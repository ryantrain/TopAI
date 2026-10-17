# Agent Exchange: Dynamic AI Evaluation

Agent Exchange helps students and teachers compare AI agents on a task they define. The current reference use case is integral mathematics: a user describes the kind of integral test or question-solving task they need, uploads a curated dataset, and runs the same experiment against three worker agents. The app scores the responses and shows which agent performed best for that task.

The benchmark pipeline is general. Integral questions are the present use case, but the prompt parser and scoring system also support classification, numeric estimation, structured JSON, generated-item counting, and rubric-graded responses.

## How it works

```text
User goal
   ↓
Local Ollama benchmark planner
   ↓
Reviewable task instructions + scoring method
   ↓
Uploaded JSON, JSONL, or CSV dataset
   ↓
Three worker agents answer matched public and holdout batches
   ↓
Python scoring or a local Ollama rubric judge
   ↓
Accuracy, speed, token efficiency, cost estimates, and best agent
```

The planner does not create ground truth. The uploaded dataset supplies the evaluation questions and reference answers. Users review and save the generated benchmark criteria before a run.

## Integral-test workflow

1. Describe the task in plain language, for example: `Find the best model for solving first-year integration problems. Return only the final numeric answer.`
2. Click **Build benchmark from my request**. Local Ollama converts the request into an editable benchmark plan: task instructions, scoring method, tolerance, rubric, and pass threshold where applicable.
3. Upload one UTF-8 `.json`, `.jsonl`, or `.csv` dataset containing at least 20 distinct examples.
4. Review and save the benchmark criteria.
5. Choose the worker models and run one or more rounds.
6. Inspect each model's answers, evaluation results, accuracy, response time, token efficiency, estimated cost, and overall ranking.

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

## Evaluation methods

| Method | Use it for | How it is scored |
| --- | --- | --- |
| Numeric | Definite integrals, marks, measurements | Absolute difference within the saved tolerance |
| Exact | Labels or short canonical answers | Case-sensitive text equality after trimming surrounding whitespace |
| JSON | Structured extraction or generated schemas | Recursive structural equality; object key order is ignored |
| Rubric | Explanations, worked solutions, test quality | A local Ollama judge scores each response from 0–100 against the saved rubric |
| Items | Generating test questions or ideas | Counts distinct, nonempty strings returned in a JSON array |

Rubric scores are model estimates and should be calibrated against human judgments. Item scoring measures output quantity and valid format, not originality or teaching quality.

## Run locally

Requirements:

- Node.js 20.9+
- Python 3.11+
- [Ollama](https://ollama.com/) for prompt parsing and rubric judging

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

Open <http://127.0.0.1:3000>. Ollama must be running at `http://127.0.0.1:11434` when drafting general benchmark plans or using rubric scoring.

## Model configuration

Copy `.env.example` to `.env`. Three worker slots can use OpenAI, Gemini, Anthropic, or local Ollama models.

For a fully local experiment:

```dotenv
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_JUDGE_MODEL=qwen2.5:7b

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

- accuracy or rubric pass rate;
- response time per attempted question;
- correct answers per 1,000 provider-reported tokens;
- optional estimated cost per 1,000 tokens;
- an overall relative score across the selected worker lineup;
- the underlying questions, answers, and evaluation reasons.

Results apply only to the uploaded dataset, saved criteria, configured models, and run conditions. They are not universal model rankings. Demo mode uses seeded simulated answers, token counts, and timings and does not establish real model performance.

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
