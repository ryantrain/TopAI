# Dynamic benchmarks

A dataset contains questions and trusted reference answers. A benchmark plan records how agents should answer and how the judge should score them.

## Workflow

1. The user uploads or selects worksheets containing at least 10 distinct questions.
2. The user describes the task in plain language.
3. Local Ollama drafts an editable execution plan: instructions, scoring method, tolerance, pass threshold, selection order, and repetitions.
4. The user reviews and saves that plan.
5. One to six configured API or local agents answer the same 10 questions concurrently. If their provider configuration is incomplete, the app uses three seeded demo agents.
6. Gemini judges each agent's completed answer batch when configured. If Gemini is unavailable, OpenAI is tried next, then local Ollama. Item counting stays deterministic in Python.
7. Python stores the judge verdicts and updates the accuracy, speed, token, cost, and overall-score graphs.
8. An additional quiz uses the next 10 previously unused questions.

Reference answers never enter worker prompts. The AI judge receives questions, references, agent responses, and the saved criteria. Every verdict includes a score, correct/incorrect decision, and short reason that can be inspected in the UI.

## Execution plan

`execution_spec` is validated JSON. It configures supported backend behavior; prose cannot add tools or scoring algorithms.

```json
{
  "procedure": "Give every agent the same ten integral questions and judge mathematical equivalence against the references.",
  "selection": "shuffled",
  "repetitions": 1,
  "unsupported_requirements": [],
  "method": "rubric",
  "output_unit": "answers",
  "instructions": "Solve each integral and return the final answer as LaTeX.",
  "rubric": "Accept mathematically equivalent forms and valid arbitrary constants.",
  "tolerance": 0.000001,
  "pass_score": 80
}
```

- `selection` is `sequential` or reproducibly `shuffled`.
- `repetitions` runs each agent 1–5 times on the same 10 questions to measure output stability.
- `method` is `exact`, `numeric`, `json`, `rubric`, or `items`.
- `tolerance` controls numeric absolute error.
- `pass_score` converts the judge's 0–100 grade into correct/incorrect.
- `instructions` go to every tested agent; `rubric` goes to the judge.
- `unsupported_requirements` blocks plans that ask for measurements the backend cannot perform.

## Who does what

| Step | Component |
| --- | --- |
| Draft benchmark metrics | Local Ollama |
| Answer the questions | 1–6 configured agents, or 3 seeded demo agents |
| Judge answers | Gemini first, OpenAI second, local Ollama fallback |
| Count generated items | Python |
| Store results and update graphs | Python/FastAPI backend |

The graph is driven only by evaluator scores and benchmark measurements.

## Configuration

```dotenv
WORKER_PROVIDERS=gemini,gemini,gemini
WORKER_MODELS=gemini-3.8-flash,gemini-3.8-flash,gemini-3.8-flash
WORKER_COST_PER_1K_TOKENS=,,

GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.8-flash

OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_JUDGE_MODEL=

OLLAMA_MODEL=qwen2.5:7b
```

Start Ollama separately and install the configured local model:

```bash
ollama serve
ollama pull qwen2.5:7b
```

Structured JSON and CSV files import directly. Converting PDFs, photos, Word, Excel, PowerPoint, and text worksheets uses Gemini. Judging tries configured providers in the order Gemini, OpenAI, then Ollama. A full benchmark can remain local when worker agents and the judge use Ollama.

## Interpretation

- Scores apply only to the supplied questions, criteria, evaluator, and model versions.
- An AI judge can be inconsistent or wrong. Calibrate important benchmarks with teacher-reviewed examples.
- Repetitions measure exact output stability. Numeric plans also report mean absolute error and signed bias.
- Worker timing and token metrics exclude judge latency and judge tokens.
- Demo results are seeded simulations and do not measure real model quality.
- Exact duplicate checks cannot detect paraphrased duplicates or bad answer keys.
