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
2. Local Ollama translates that request and available dataset context into an editable benchmark plan.
3. The user uploads one JSON, JSONL, or CSV dataset containing questions or task inputs and human-curated reference answers.
4. The user reviews and saves the instructions, scoring method, tolerance, rubric, and pass threshold.
5. Three worker agents receive identical inputs without reference answers.
6. Deterministic Python scoring or a local Ollama judge evaluates their responses.
7. The dashboard shows the evidence and highlights the best-performing agent for this specific experiment.

## Reference Use Case: Integral Tests

The first supported product story is evaluating agents on integral mathematics. Suitable experiments include:

- solving definite integrals with numeric tolerance;
- classifying integral techniques with exact labels;
- producing structured solution data with JSON scoring;
- evaluating worked solutions against a teacher-authored rubric;
- generating sets of integral practice questions with item-count scoring.

The user supplies the source material and reference answers. Ollama may propose how to evaluate the task, but it must not invent ground truth or silently commit benchmark criteria.

## Evaluation Model

Each round uses 10 public examples and 10 fresh holdout examples. Every worker sees the same inputs. Reference answers remain outside worker prompts.

Supported evaluation methods are:

- exact text comparison;
- numeric comparison with an absolute tolerance;
- structural JSON equality;
- local Ollama rubric judging with a configurable pass score;
- distinct generated-item counting.

The product reports accuracy or pass rate, elapsed time, provider-reported token efficiency, optional operator-supplied cost estimates, and an overall score relative to the selected lineup. Users can inspect individual questions, answers, and grading evidence.

## Product Principles

1. Make every comparison task-specific and evidence-based.
2. Keep benchmark criteria visible, editable, and frozen once an experiment begins.
3. Never expose reference answers to worker agents.
4. Separate measured worker performance from evaluator judgment and from the virtual-market visualization.
5. Describe results as valid for this dataset and run, never as universal model superiority.
6. Keep local inference available for educational data that should not be sent to cloud providers.
7. Preserve a reproducible record of the dataset digest, criteria, model configuration, answers, grading, usage, and timing.

## Capabilities

- Plain-language task entry before or after dataset upload.
- Local Ollama benchmark-plan drafting.
- CSV, JSON, and JSONL imports with 20–2,000 examples.
- Three configurable worker slots using Ollama, Gemini, OpenAI, or Anthropic.
- Deterministic and rubric-based evaluation methods.
- Public and holdout batches across 1–10 rounds.
- Per-model accuracy, speed, token efficiency, estimated cost, and answer inspection.
- SQLite storage by default, with optional TigerData/PostgreSQL archives.
- Optional Phantom-signed Solana Devnet receipts for completed rounds.

## Constraints and Honest Boundaries

- The application is a local, single-user prototype without authentication or user isolation.
- The current interface accepts one dataset file per active session; uploading another replaces it.
- At least 20 distinct examples are required, with 20 consumed per round.
- The importer catches exact duplicate questions but cannot detect semantic leakage or low-quality references.
- Rubric grading is an estimate from a local judge model and requires calibration against human ratings.
- Generated-item scoring measures distinct valid strings, not originality, mathematical quality, or curriculum suitability.
- Provider token counts are not directly comparable tokenizers or verified invoices.
- Demo mode is simulated and cannot support claims about real model quality.
- The virtual market is an exploratory visualization and is not financial trading.
- Solana records an optional digest after a round; evaluation and settlement remain in Python.
- Results depend on the uploaded data, prompt, rubric, model versions, and machine/provider conditions.

## Privacy and Safety

API keys remain in the backend environment. Cloud worker configurations send benchmark prompts to their providers. Fully local runs can use Ollama for workers, planning, judging, trading, and analysis. Users must have permission to process uploaded educational or student data and should remove identifying information when it is unnecessary for the experiment.

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
5. Validate Ollama rubric scores against teacher judgments before using them for recommendations.
