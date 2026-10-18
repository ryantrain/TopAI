# Product

## Product summary

Agent Exchange is a task-specific AI evaluation classroom. A student or teacher describes what they need, uploads material with trusted answers, and compares up to six agents on the same task. The product ranks agents using inspectable evidence from that material rather than a generic leaderboard.

Integral mathematics is the reference use case. The same benchmark plan supports other subjects and tasks because its instructions and scoring criteria come from the user's request.

## Primary users

- Teachers choosing a model for creating or assessing exercises.
- Students choosing AI help for a defined type of problem.
- Developers running small, inspectable comparisons on their own examples.

## Core journey

1. The user adds worksheets and describes the task in plain language.
2. Local Ollama drafts an editable benchmark plan with instructions, scoring method, tolerance, and pass threshold.
3. The user reviews and saves the plan.
4. The app detects one to six configured agents and their required keys. A complete setup uses those agents; an incomplete setup falls back to three seeded simulated agents.
5. Every agent receives the same 10 questions concurrently without reference answers.
6. Gemini grades each completed batch when `GEMINI_API_KEY` exists. If Gemini is absent or its request fails, local Ollama grades it. Deterministic item counting remains in Python.
7. Python stores the verdicts and updates the live graph and metrics.
8. The same process runs on 10 unused held-out questions.
9. The dashboard recommends the strongest agent for this task and lets the user inspect every response and grade.

## Evaluation rules

- Each round consumes 10 public and 10 held-out examples.
- Questions and reference answers come from user-selected worksheets.
- Reference answers never enter worker prompts.
- API agent calls run concurrently.
- AI grading is batched once per agent per stage.
- The saved evaluator identity is attached to the benchmark plan and result.
- A malformed response or evaluator failure rolls back the round rather than inventing partial results.
- Rankings apply to this dataset and run; they do not establish universal model quality.

For symbolic integral answers, the default rubric asks the evaluator to recognize mathematically equivalent forms, integration constants, domains, and convergence. This is an AI judgment, not a symbolic proof engine, and should be calibrated against teacher-reviewed examples.

## Product principles

1. Compare models on the user's actual task.
2. Keep criteria visible, editable, and frozen during a run.
3. Keep answer keys away from worker agents.
4. Label API measurements and seeded demo measurements clearly.
5. Expose the evidence behind each recommendation.
6. Preserve a reproducible record of dataset digest, criteria, model configuration, answers, grades, usage, and timing.
7. Keep a local fallback when cloud evaluation is unavailable or unwanted.

## Capabilities

- Plain-language benchmark requests.
- Local Ollama benchmark-plan drafting.
- Automatic selection of one to six configured API/local agents.
- Three-agent simulated fallback when provider setup is incomplete.
- Gemini-first grading with local Ollama fallback.
- CSV, JSON, JSONL, PDF, image, Word, Excel, PowerPoint, and text worksheet intake.
- Exact, numeric, JSON, item-count, and rubric methods.
- Public and held-out batches over one to ten rounds.
- Accuracy, speed, token efficiency, cost, repeatability, and answer inspection.
- SQLite storage with optional TigerData/PostgreSQL.
- Optional Phantom-signed Solana Devnet result receipts.

## Boundaries

- This is a local, single-user prototype without authentication or user isolation.
- A runnable selection needs at least 20 distinct examples; each round consumes 20.
- Exact duplicate detection cannot find semantic overlap or a wrong answer key.
- Gemini and Ollama verdicts can be inconsistent or wrong, especially on borderline answers.
- Provider token counts use different tokenizers and configured costs are estimates.
- Demo mode demonstrates the workflow and cannot support claims about real model performance.
- The virtual market is an experimental visualization, not a financial product.
- Solana stores an optional digest only; orchestration and settlement stay in Python.

## Privacy

API keys remain in the backend environment. Cloud workers receive benchmark questions and instructions. Gemini evaluation receives the questions, worker responses, reference answers, and rubric. Without a Gemini key, Ollama evaluation stays local. Worksheet conversion for unstructured files also uses Gemini. Users must have permission to process uploaded educational material and should remove unnecessary identifying information.

## Success criteria

The product succeeds when a student or teacher can describe an integral task, review a sensible plan, run representative examples against available agents, understand the ranking, and challenge or reproduce it from the saved evidence.

## Near-term direction

1. Add a first-class integral dataset template and calibrated teacher examples.
2. Let users name and describe configured agent slots.
3. Add symbolic verification alongside AI evaluation for math tasks.
4. Add criterion-level educational metrics and evaluator disagreement reporting.
5. Validate recommendations against teacher judgments.
