# Agent Classroom

Agent Classroom helps students and teachers find the best AI model for a specific task using their own material. The reference use case is integral mathematics: describe the job, upload worksheets with trusted answers, and compare up to six agents on the same questions.

The benchmark engine is general enough for numeric answers, exact labels, structured JSON, generated-item counts, and rubric-judged responses.

## Execution flow

```text
User chooses 1–6 real agents or explicitly selects the 3-agent demo
   ↓
User describes the task and uploads worksheets
   ↓
Local Ollama drafts editable benchmark criteria
   ↓
Run the selected API/local agents concurrently, or run the demo agents
   ↓
Gemini evaluates each completed answer batch when GEMINI_API_KEY is set
   └─ missing or failed Gemini request: OpenAI evaluates when OPENAI_API_KEY is set
       └─ missing or failed OpenAI request: local Ollama evaluates the batch
   ↓
Python stores verdicts and updates accuracy, speed, token, cost, and chart data
   ↓
Update the graph from judge scores; repeat on the next 10 questions if requested
```

The uploaded dataset supplies the questions and reference answers. Reference answers never enter worker prompts. Every quiz gives the same 10 fresh questions to all selected agents.

Item counting is deterministic Python. Other saved benchmark methods use the selected AI evaluator, so their verdicts are model assessments rather than formal proofs. Users can inspect each question, response, verdict, and reason.

## Run locally

Requirements:

- Node.js 20.9+
- Python 3.11+
- [Ollama](https://ollama.com/) for benchmark planning and the final evaluation fallback
- Provider API keys for real agents, or use the explicit demo option

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

The setup screen accepts one to six agents. Each new slot gets a distinct classroom character; set its display name, choose OpenAI, Gemini, Anthropic, or local Ollama, and select its model. Cloud API keys entered there stay only in backend process memory and are never returned to the browser or written to the database. Restarting FastAPI clears them.

You can keep credentials in `.env` instead. Copy `.env.example` to `.env`; `WORKER_PROVIDERS` accepts one to six comma-separated providers, while `WORKER_MODELS` and `WORKER_COST_PER_1K_TOKENS` follow the same order.

```dotenv
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.5-flash-lite

OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
# Optional; blank uses OPENAI_MODEL.
OPENAI_JUDGE_MODEL=

WORKER_PROVIDERS=gemini,gemini,gemini
WORKER_MODELS=gemini-2.5-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash-lite
WORKER_COST_PER_1K_TOKENS=,,

OLLAMA_MODEL=qwen2.5:7b
```

The built-in cloud defaults are `gpt-4o-mini`, `gemini-2.5-flash-lite`, and `claude-sonnet-4-6`. Choose **Custom model…** for another OpenAI or Anthropic model.

At setup, choose **Use real agents** after entering the configuration, or **Skip and use 3 demo agents**. The app never silently changes a requested real-agent run into a demo.

Evaluation follows a separate priority:

1. `GEMINI_API_KEY` present: Gemini judges answer batches.
2. If Gemini is not configured or its request fails and `OPENAI_API_KEY` is present: OpenAI judges them.
3. If neither cloud judge succeeds: `OLLAMA_MODEL` judges locally.

Ollama always drafts benchmark plans. Structured CSV/JSON imports need no conversion model. PDF, photo, Word, Excel, PowerPoint, and text worksheet conversion uses Gemini, with `GEMINI_CONVERT_MODEL` falling back to `GEMINI_MODEL`.

## Use the integral benchmark

1. Configure one to six real agents, or select the three-agent demo.
2. Add or select worksheets totaling at least 10 questions.
3. Describe the task, such as `Find the best agent for first-year indefinite integrals.`
4. Press send. The app requires local Ollama to build benchmark metrics from the request before any quiz can start.
5. Review the generated method, instructions, rubric, and number of quizzes.
6. Press send again to start the class, then inspect the recommendation, result table, chart, and marked answers.

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

Provide at least 10 distinct examples and 10 more for every additional quiz. Imports reject exact duplicate questions, but cannot detect paraphrased leakage or inaccurate answer keys.

## Metrics

The dashboard reports:

- evaluator-marked accuracy or pass rate;
- worker time per attempted question;
- correct answers per 1,000 worker tokens;
- optional estimated worker cost;
- an overall relative score combining token efficiency and throughput;
- repeat agreement and numeric error diagnostics when applicable.

Demo timing and token counts are seeded simulation values. Evaluator latency and evaluator tokens are excluded from worker metrics. Results apply only to the uploaded data, prompt, criteria, evaluator, and model versions used in that run.

## Storage

SQLite is the default. Set `DATABASE_URL` to a TigerData/PostgreSQL connection string to store active state and completed-quiz archives remotely. Changing storage backends does not migrate existing history.

Uploaded worksheet source files remain in owner-only local storage. Cloud workers receive benchmark questions. The active cloud judge receives questions, worker answers, references, and criteria. When neither cloud judge is configured or succeeds, Ollama evaluation stays on the local machine. Remove unnecessary personal information from student material before using cloud services.

## API and verification

Important routes:

- `GET /api/session` — state plus detected agent/evaluator configuration
- `POST /api/benchmark/suggest` and `PUT /api/benchmark` — draft and save criteria
- `POST /api/library/convert` and `PUT /api/library/selection` — import and select worksheets
- `POST /api/rounds` — run 1–10 quizzes
- `POST /api/reset` — start a new session
- `GET /api/history` — archived quizzes

```bash
.venv/bin/python -m unittest backend.test_session backend.test_integrations backend.test_datasets backend.test_evaluation -v
node app/api-response.test.mjs
node app/model-metrics.test.mjs
npm run build
```

The automated suite mocks external providers and databases. Real credentials and services require a separate integration run.
