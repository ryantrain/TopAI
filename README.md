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
┌─ one round = one batch of questions (20 by default) ─────┐
│ The batch goes to all 3 demo agents concurrently;        │
│ each agent answers the whole batch in one call           │
│   ↓                                                      │
│ Each agent's answers go to Gemini in ONE call, with the  │
│ reference answers; Gemini returns correct / not correct  │
│ with a reason for each                                   │
│   ↓                                                      │
│ The Python backend stores the verdicts and updates the   │
│ UI graph and metrics                                     │
└──────────────────────────────────────────────────────────┘
   ↓   (the next round draws the next unused batch)
Final accuracy, speed, token efficiency, cost estimates, and best agent
```

The planner does not create ground truth. The uploaded dataset supplies the evaluation questions and reference answers. Users review and save the generated benchmark criteria before a run.

Grading is batched on purpose, to stay inside Gemini's rate limits. One round makes **3 Gemini calls** — one per agent, the whole batch of answers each, all 3 in flight at a time — not one call per answer. Scores and metrics therefore advance once per round, when the batch is graded, rather than continuously; the price chart gains its points at the public stage, on each trade, and at settlement.

## Integral-test workflow

1. Describe the task in plain language, for example: `Find the best model for solving first-year integration problems. Return only the final numeric answer.`
2. Click **Build benchmark from my request**. Local Ollama converts the request into an editable set of benchmark metrics: task instructions, what counts as a correct answer, tolerance, and pass threshold.
3. Upload one UTF-8 `.json`, `.jsonl`, or `.csv` dataset containing at least 20 distinct examples.
4. Review and save the benchmark criteria.
5. Choose the worker models and run one or more rounds.
6. Each stage runs as a batch: the three agents each answer all 10 questions, Gemini grades each agent's 10 answers in a single call, and the backend stores the verdicts and updates the graph and metrics.
7. Inspect each model's answers, evaluation results, accuracy, response time, token efficiency, estimated cost, and overall ranking.

Each round grades one unused batch of questions. The batch is 20 by default; set `batch_size` (1–50) in the saved execution plan to change it. Reference answers never enter worker prompts.

Size the dataset to a whole multiple of the batch, or the remainder is never used: 99 questions at a batch of 20 runs 4 rounds and strands 19 questions, while 100 runs 5 rounds and strands none.

| questions | batch | rounds | Gemini calls |
| --- | --- | --- | --- |
| 100 | 20 | 5 | 15 |
| 100 | 25 | 4 | 12 |
| 99 | 20 | 4 | 12 (19 questions unused) |

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
- A `GEMINI_API_KEY` for answer unpacking and grading, or local Ollama as fallback

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

Open <http://127.0.0.1:3000>. Ollama must be running at `http://127.0.0.1:11434` to draft benchmark metrics from a request. Gemini is preferred for saved benchmark criteria; missing keys and HTTP 429 rate limits automatically use local `OLLAMA_MODEL` instead. Saved criteria are graded in demo mode too.

## Model configuration

Copy `.env.example` to `.env`. Three worker slots can use OpenAI, Gemini, Anthropic, or local Ollama models. Avoid putting Gemini in a worker slot, since Gemini is the evaluator.

Evaluation prefers Gemini and falls back to local `OLLAMA_MODEL` when its key is missing or it returns HTTP 429. For local demo agents:

```dotenv
OLLAMA_MODEL=qwen2.5:7b
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.0-flash

WORKER_PROVIDERS=ollama,ollama,ollama
WORKER_MODELS=qwen2.5:7b,llama3.1:8b,mistral:7b

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

### Worksheets

Users only upload worksheets: PDFs, photos, Word, Excel, PowerPoint, or text files up to 10 MB each, several at a time. Behind the scenes the backend sends each file to Gemini (`GEMINI_API_KEY`; `GEMINI_CONVERT_MODEL`, falling back to `GEMINI_MODEL`), which extracts each question with one clear, short answer into question/answer data. When the key is missing or Gemini returns HTTP 429, conversion uses local `OLLAMA_MODEL`: PDFs have their text extracted locally and images require an installed vision model. Scanned PDFs without text must be uploaded as page images or processed with Gemini. Install backend requirements after updating. The page never mentions the conversion. It uses the worksheet's answer key when there is one; answers it had to work out are counted per worksheet so users can check them. All-numeric answers use numeric scoring; anything else uses exact text matching, unless saved criteria choose another evaluation method. Setup and quota problems are logged on the server; the page shows a plain message.

Every uploaded worksheet is saved to the worksheet menu next to **Run** and selected straight away; worksheets uploaded together are selected together. Tick one or more worksheets to combine them: questions alternate between worksheets so each round mixes them, and duplicates are dropped. Combined worksheets use numeric scoring only if every worksheet does. A selection needs at least 20 questions in total to run. **Forget** removes a worksheet from the menu. Saved worksheets survive **New session**; the selection is fixed once a session has run a round.

The importer rejects duplicate questions so the same question is not graded twice across rounds. It cannot detect paraphrased duplicates or overlap between examples embedded in instructions and evaluation cases.

## Results

The dashboard reports:

- the percentage of answers Gemini marked correct;
- response time per attempted question;
- correct answers per 1,000 provider-reported tokens;
- optional estimated cost per 1,000 tokens;
- an overall relative score across the selected worker lineup;
- the underlying questions, answers, and Gemini's reason for each verdict.

These update once per round, when the batch is graded. Demo mode simulates both answers and scores without model calls. Live timing and token figures cover workers only; evaluator latency and tokens are excluded. Local model requests run one at a time to avoid competing for the same accelerator.

Results apply only to the uploaded dataset, saved criteria, configured models, Gemini's judgment, and run conditions. They are not universal model rankings. Demo mode uses seeded simulated answers, token counts, and timings and does not establish real model performance.

The existing virtual market remains an experimental visualization layer: seeded trading strategies react to each round's benchmark result. They are deterministic rules, not model calls, so they cost no tokens. Since the holdout stage is gone, they settle against the score they already saw, so the market carries no forecasting risk and its P&L is not meaningful. It is separate from the direct model-comparison metrics and should not be treated as a financial product or as evidence that a trading strategy is valid.

## Storage and optional receipts

SQLite is used by default. Set `DATABASE_URL` to a TigerData/PostgreSQL connection string to store active state and completed-round archives remotely. The backend creates `exchange_market` and `exchange_rounds`; switching storage backends does not migrate existing SQLite history.

After settlement, a user may publish a hash of the round through a Phantom-signed Solana Devnet memo. This is an optional audit receipt. It does not execute model evaluation or transfer tokens on-chain.

## API

- `GET /api/market` — current experiment state
- `POST /api/benchmark/suggest` — draft benchmark criteria from a plain-language goal
- `PUT /api/benchmark` — validate and save benchmark criteria
- `POST /api/dataset?filename=...&scoring=...` — upload a benchmark dataset
- `DELETE /api/dataset` — remove the active dataset before a run
- `POST /api/library/convert` — turn an uploaded worksheet into saved benchmark questions and select it
- `PUT /api/library/selection` — choose which saved worksheets make up the dataset
- `GET /api/library/{id}` and `DELETE /api/library/{id}` — export a worksheet's questions, or forget it
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

## Four-person split

| Owner | Scope |
| --- | --- |
| Worker / benchmark | `benchmark`, `ask`, GSM8K loading and numeric grading in `backend/main.py` |
| Trading agents | `trading` and the seeded strategies in `backend/main.py` |
| Market / API | `execute_order`, `settle`, SQLite persistence, FastAPI routes |
| Dashboard | `app/page.js`, `app/globals.css`, Recharts |

API: `GET /api/market`, `POST /api/rounds` with `{"mode":"demo","rounds":3}` or `{"mode":"live","rounds":3}` (1–10 rounds; defaults to 1), `POST /api/reset`, `GET /api/history`, `GET /api/receipt`, and `POST /api/receipt` with signature, session ID, and round. Next.js proxies `/api/*` to port 8000; override with `BACKEND_URL` if needed. FastAPI's local interactive API reference is at http://127.0.0.1:8000/docs.

## Model comparison metrics

The main chart switches between correct questions per 1,000 provider-reported total tokens (higher is better), batch response seconds per attempted question (lower is better), and an overall score. Tokens include input, cached input, output, and reasoning where reported by the provider. Provider tokenizers differ, so this is token efficiency rather than dollar cost. Timing includes provider/network latency and is amortized across ten questions, not measured individual question latency.

Category winners include ties. Overall is 100 × the geometric mean of (correct questions/token ÷ the best worker’s rate) and (correct questions/second ÷ the best worker’s rate), with equal weight. Zero-correct workers cannot win overall. Summary comparisons pool matched batches in the selected rounds; chart points compare each batch separately. Overall scores are relative to the selected lineup and workload, not universal model ratings.

Only batches with valid token and timing measurements for every worker are compared. Older histories remain visible elsewhere but are excluded from these metrics. Run new rounds to collect measurements. Demo token counts and timings are seeded simulations, not API measurements. The virtual-credit trading and redemption rules remain separate from the model metrics.

### Custom benchmarks

In Overview, upload a UTF-8 CSV, JSON array, or JSONL file with `question` and `answer` fields. A CSV template is available in the dashboard. Supply 20–2,000 distinct questions, up to 2 MB. Select exact text matching (case-sensitive, surrounding whitespace ignored) or numeric matching (absolute tolerance 0.000001). Open-ended prose needs a different evaluator and is not supported by these scoring rules.

Every round consumes one unused batch of questions, 20 by default. All workers receive the same questions without answer keys. Dataset changes require a new session to keep comparisons consistent. Uploads persist in the configured database and completed-round archives; resetting clears the active dataset but retains archives. Live runs send questions to configured AI providers; demo results remain simulated. This is a local shared workspace without user isolation or authentication.

### Cost per 1,000 tokens

Set `WORKER_COST_PER_1K_TOKENS=0.001,0.002,0.003` in the backend environment (illustrative rates only), in the same order as `WORKER_PROVIDERS` / `WORKER_MODELS`. These are operator-supplied **blended USD estimates**, not verified provider invoices. Account for the expected input/output mix, reasoning, caching, and discounts when setting them. Blank entries mean unknown; zero explicitly means free. Start a new session after changing rates. Demo and older unpriced batches show no dollar estimate. The table computes `sum(estimated batch USD) / sum(provider tokens) × 1,000` across matched batches and requires every selected batch to have pricing. Only worker benchmark calls are included.

### Dynamic paper-grading benchmarks

Download the paper grading JSON template from the dataset panel, replace its placeholder papers and marks, choose **Numeric answer**, and upload it. JSON can be an object with:

- `instructions`: task, rubric, mark scale, output requirements, and separately curated marked calibration examples (up to 30,000 characters).
- `tolerance`: nonnegative absolute mark difference counted as agreement, e.g. `1` for within one mark. Defaults to `0.000001`.
- `examples`: 20–2,000 distinct `{ "question": "paper + assignment prompt", "answer": 8 }` evaluation examples. Answers are human reference marks.

All three workers receive the same instructions and paper batches. Evaluation marks remain outside their prompts. Each round reserves ten unused papers for settlement. Keep calibration examples separate from evaluation papers; the importer detects duplicate evaluation questions but cannot detect semantic overlap with calibration text. Instructions, tolerance, raw-file digest, results, usage, and elapsed time persist with the session/archive.

Compare agreement percentage, average batch seconds per paper, token efficiency, and estimated dollars per 1,000 tokens. Existing overall ranking balances correct answers per token and per second; it is not a validated measure of feedback quality. Set Minimum accuracy to identify the fastest model meeting your required agreement threshold, then compare cost. Tied speeds remain tied; if no model qualifies, no winner is recommended. Results apply to the uploaded papers and rubric; repeat with representative data before relying on a winner.

For broader dynamic evaluation, the next step is criterion-level human labels and mean absolute mark error, plus confidence intervals across repeated runs. Free-form feedback quality requires separate human review or a calibrated judge; numeric mark agreement alone does not measure it. The current implementation evaluates marks and retains the existing three configured worker slots and market round lifecycle.

### Goal-driven dynamic evaluation

After uploading a dataset, describe your specific need and build a benchmark execution plan. Local Ollama produces a reviewable JSON string controlling example selection, repeated model calls, scoring, tolerance, and judge criteria. The backend validates and executes those settings and reports repeat agreement plus numeric error/bias where applicable. Unsupported operations are rejected. See [dynamic benchmarking and local setup](DYNAMIC_BENCHMARKS.md) for the plan contract, local configuration, and measurement limits.

LaTeX integral question/answer datasets (including mixed symbolic and numeric answers) are recognized on upload. The app preserves the reference strings and automatically saves a local rubric judging plan that checks mathematical equivalence, integration constants, domains, and convergence. This overrides numeric fallback scoring for these datasets. Local Ollama must be available for live judging; judgments are model assessments rather than symbolic proofs. Extra `id` and `topic` fields are accepted but are not used in scoring.
