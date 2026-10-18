# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web application with a Next.js dashboard and FastAPI backend.

## Product Summary

Agent Exchange is a task-specific AI evaluation lab. A user describes what they need an AI model to do, reviews benchmark criteria drafted by a local Ollama model, uploads reference examples, and runs the same experiment against three worker agents. The product scores the results and identifies the strongest agent for that task based on accuracy, speed, token efficiency, and optional cost estimates.

The current reference use case is integral mathematics for students and teachers. A teacher can compare agents on solving integral questions or generating integral-test material, using a curated dataset and explicit scoring criteria. A student can compare which configured agent performs best on the kind of integral practice they need. The same pipeline can later support other subjects and tasks because the benchmark plan is generated from the user's goal instead of being fixed to one curriculum.

## Primary Users

- Teachers comparing AI models before using them to create or assess integral exercises.
- Students comparing AI assistance on a defined set of integral problems.
- Researchers and developers running small, inspectable evaluations against their own datasets.

## Core User Journey

1. The user describes the required task in plain language.
2. Local Ollama translates that request and available dataset context into an editable benchmark plan: the metrics, instructions, tolerance, and pass threshold.
3. The user uploads one JSON, JSONL, or CSV dataset containing questions or task inputs and human-curated reference answers.
4. The user reviews and saves the plan. It is frozen once the run starts.
5. The benchmark runs in batches of 10 questions. The three demo agents receive the same batch, without reference answers, concurrently, and each answers all 10 in one call.
6. Each simulated agent's batch of answers goes to local Ollama together with the reference answers. Ollama returns a correct / not correct verdict with a reason for each answer.
7. The Python backend stores the verdicts and updates the UI graph and metric panels.
8. A round runs two such stages: 10 public questions, then 10 unused holdout questions. Further rounds consume the next batches until the dataset is exhausted.
9. The dashboard shows the accumulated evidence and highlights the best-performing agent for this specific experiment.

## Reference Use Case: Integral Tests

The first supported product story is evaluating agents on integral mathematics. Suitable experiments include:

- solving definite integrals within a numeric tolerance;
- classifying integral techniques;
- producing structured solution data;
- producing worked solutions judged against teacher-authored criteria;
- generating sets of integral practice questions.

The user supplies the source material and reference answers. Ollama may propose how to describe the task and judge an answer against the user's reference, but it must not invent ground truth or silently commit benchmark criteria.

## Evaluation Model

Each round uses 10 public examples and 10 fresh holdout examples. Every worker sees the same inputs. Reference answers remain outside worker prompts.

Evaluation uses local Ollama: it receives the question, the simulated agent's answer, the reference answer, and the saved criteria, and decides whether the answer is correct.

The saved criteria inform that decision rather than switching evaluators:

- task instructions describe what the agent was asked to produce;
- tolerance sets how close a numeric answer must be;
- the pass threshold sets how strict to be on open-ended or partially correct answers.

Ollama turns the user's request into metrics and judges the simulated answers. Python orchestrates the batches, stores each verdict, and updates the interface.

Grading is batched: one local Ollama call per agent per stage, 10 answers each, for 6 judge calls per round. The interface advances at stage boundaries, twice per round, not after each individual answer.

The product reports Ollama-judged accuracy or pass rate alongside seeded demo timing and token-efficiency values. Users can inspect individual questions, simulated answers, and grading evidence.

## Product Principles

1. Make every comparison task-specific and evidence-based.
2. Keep benchmark criteria visible, editable, and frozen once an experiment begins.
3. Never expose reference answers to worker agents.
4. Separate measured worker performance from Gemini's judgment and from the virtual-market visualization. Report accuracy as what Gemini marked correct, never as verified truth.
5. Describe results as valid for this dataset and run, never as universal model superiority.
6. Keep local inference available for educational data that should not be sent to cloud providers.
7. Preserve a reproducible record of the dataset digest, criteria, model configuration, answers, grading, usage, and timing.

## Capabilities

- Plain-language task entry before or after dataset upload.
- Local Ollama benchmark-metric drafting from the user's request.
- Local Ollama verdicts on every answer, requested one batch per simulated agent per stage.
- Stage-by-stage UI updates driven by the Python backend.
- CSV, JSON, and JSONL imports with 20–2,000 examples.
- Three configurable worker slots using Ollama, Gemini, OpenAI, or Anthropic.
- A single local Ollama evaluator covering numeric, exact, structured, and open-ended answers.
- Public and holdout batches across 1–10 rounds.
- Per-model accuracy, speed, token efficiency, estimated cost, and answer inspection.
- SQLite storage by default, with optional TigerData/PostgreSQL archives.
- Optional Phantom-signed Solana Devnet receipts for completed rounds.

## Constraints and Honest Boundaries

- The application is a local, single-user prototype without authentication or user isolation.
- The current interface accepts one dataset file per active session; uploading another replaces it.
- At least 20 distinct examples are required, with 20 consumed per round.
- The importer catches exact duplicate questions but cannot detect semantic leakage or low-quality references.
- Every verdict is an Ollama estimate. Accuracy figures require calibration against hand-graded examples before they support a recommendation.
- Ollama may rule inconsistently on borderline answers, so repeated judgments can differ.
- Evaluation sends questions, agent answers, and reference answers to Google. A fully offline run is not possible.
- A failed or malformed Ollama batch fails that whole 10-answer stage rather than one answer, and the round is rolled back; no partial verdicts are invented.
- The number of local Ollama judge requests scales with agents and stages, at 6 per round.
- Provider token counts are not directly comparable tokenizers or verified invoices.
- Demo mode is simulated and cannot support claims about real model quality.
- The virtual market is an exploratory visualization and is not financial trading.
- Solana records an optional digest after a round; state updates and settlement remain in Python.
- Results depend on the uploaded data, prompt, saved criteria, Gemini's judgment, model versions, and machine/provider conditions.

## Privacy and Safety

API keys remain in the backend environment. Cloud worker configurations send benchmark prompts to their providers. Evaluation always sends questions, agent answers, and reference answers to Gemini, so a run that must stay off third-party infrastructure is not supported in this version; the demo agents, planning, trading, and analysis can still be local. Users must have permission to process uploaded educational or student data and should remove identifying information when it is unnecessary for the experiment.

## Success Criteria

For the current integral-test use case, the product succeeds when a student or teacher can:

- describe an integral-related task without learning the internal schema;
- review a sensible benchmark plan derived from that request;
- upload representative examples with trusted answers;
- run the same test against multiple agents;
- understand why an agent ranked highest;
- reproduce or challenge the result from the saved evidence.

## Near-Term Direction

1. Provide a first-class integral dataset template and example benchmark.
2. Replace legacy market-first language in the interface with evaluation-first language.
3. Make the winning agent and the evidence behind its score the primary result.
4. Add stronger educational metrics, such as method correctness and error-category breakdowns.
5. Validate Ollama's verdicts against teacher judgments before using them for recommendations, and surface disagreement rates in the interface.
