# Product

## Product summary

Agent Classroom is a task-specific AI evaluation tool. A student or teacher describes what they need, uploads material with trusted answers, and compares up to six agents on the same task. The product ranks agents using inspectable judge scores from that material rather than a generic leaderboard.

Integral mathematics is the reference use case. The same benchmark plan supports other subjects and tasks because its instructions and scoring criteria come from the user's request.

## Primary users

- Teachers choosing a model for creating or assessing exercises.
- Students choosing AI help for a defined type of problem.
- Developers running small, inspectable comparisons on their own examples.

## Core journey

1. The user configures one to six API/local agents with provider, model, and optional in-memory key, or explicitly chooses the three-agent demo.
2. The user adds worksheets and describes the task in plain language.
3. The first send action requires local Ollama to draft an editable benchmark plan with instructions, scoring method, tolerance, and pass threshold.
4. The user reviews the generated plan and sends again to save it and start the class.
5. Every agent receives the same 10 questions concurrently without reference answers.
6. Gemini grades each completed batch when configured. If it is absent or fails, OpenAI grades it when configured; local Ollama is the final fallback. Deterministic item counting remains in Python.
7. Python stores the verdicts and updates the live graph and metrics.
8. If the user selected more quizzes, the process continues with the next 10 unused questions.
9. The dashboard recommends the strongest agent for this task and lets the user inspect every response and grade.

## Evaluation rules

- Each quiz consumes 10 previously unused examples.
- Questions and reference answers come from user-selected worksheets.
- Reference answers never enter worker prompts.
- API agent calls run concurrently.
- AI grading is batched once per agent attempt.
- The saved evaluator identity is attached to the benchmark plan and result.
- A malformed response or evaluator failure rolls back the quiz rather than inventing partial results.
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
- Interactive setup for one to six API/local agents.
- Distinct classroom characters with user-defined display names.
- Explicit three-agent simulated demo option.
- Gemini-first grading, then OpenAI, with local Ollama as the final fallback.
- CSV, JSON, JSONL, PDF, image, Word, Excel, PowerPoint, and text worksheet intake.
- Exact, numeric, JSON, item-count, and rubric methods.
- One to ten quizzes, with 10 fresh questions per quiz.
- Accuracy, speed, token efficiency, cost, repeatability, and answer inspection.
- SQLite storage with optional TigerData/PostgreSQL.

## Boundaries

- This is a local, single-user prototype without authentication or user isolation.
- A runnable selection needs at least 10 distinct examples; each quiz consumes 10.
- Exact duplicate detection cannot find semantic overlap or a wrong answer key.
- Gemini, OpenAI, and Ollama verdicts can be inconsistent or wrong, especially on borderline answers.
- Provider token counts use different tokenizers and configured costs are estimates.
- Demo mode demonstrates the workflow and cannot support claims about real model performance.

## Privacy

API keys come from the backend environment or the setup screen. Keys entered in the UI stay in backend process memory, are never returned to the browser or stored in the database, and disappear when FastAPI restarts. Cloud workers receive benchmark questions and instructions. The active cloud judge receives the questions, worker responses, reference answers, and rubric. If neither cloud judge is configured or succeeds, Ollama evaluation stays local. Worksheet conversion for unstructured files also uses Gemini. Users must have permission to process uploaded educational material and should remove unnecessary identifying information.

## Success criteria

The product succeeds when a student or teacher can describe an integral task, review a sensible plan, run representative examples against available agents, understand the ranking, and challenge or reproduce it from the saved evidence.

## Near-term direction

1. Add a first-class integral dataset template and calibrated teacher examples.
2. Add symbolic verification alongside AI evaluation for math tasks.
3. Add criterion-level educational metrics and evaluator disagreement reporting.
4. Validate recommendations against teacher judgments.
