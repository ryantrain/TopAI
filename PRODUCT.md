# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web application with a Next.js frontend (Agent Classroom) and a FastAPI backend.

## Product Summary

Agent Classroom (the backend is still named Agent Exchange) is a task-specific AI evaluation lab, framed as a classroom: the user is the teacher and the AI agents are students at their desks. A user describes what they need an AI model to do, reviews benchmark criteria drafted by a local Ollama model, uploads reference examples, and runs the same experiment against three worker agents. The product scores the results and identifies the strongest agent for that task based on accuracy, speed, token efficiency, and optional cost estimates.

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

## Interface

The frontend is a single page with three states, chosen from backend state: **Setup** (no completed quiz yet), **Running** (a run is in progress), and **Result** (at least one quiz completed). A minimal classroom style is used throughout: neutral surfaces, navy and wood accents, no cartoon elements.

- **Layout.** A left sidebar (brand, worksheet, run type, quizzes completed, New class) and a main workspace. A chat-style composer is pinned to the bottom of the workspace on every screen.
- **Composer.** A text box for the task, a **+** button to add worksheets, and an **↑** button (or Enter) to start the class. **+** accepts several files at once, up to 10 MB each: CSV, JSON and JSONL are imported as they are; PDFs, photos, Word, Excel, PowerPoint and text files are converted to questions and answers by Gemini on the server (`GEMINI_API_KEY`, optional `GEMINI_CONVERT_MODEL`). Every added file is saved to the worksheet library and selected; files added together are selected together.
- **Composer chips (Setup).** **Worksheets** menu (tick one or more saved worksheets to merge them into one question set, untick all for the built-in sample questions, remove files; shows the question count and how many quizzes it allows; answers the converter had to work out itself are flagged for checking), **Marking** method (with ± tolerance for numeric), **Run** (Practice or Real models), **Repeats** (1–5: each agent answers every question that many times to measure consistency), **Quizzes**, **Details** (instructions, rubric, pass score, counted unit, and any requirements the drafted plan says it cannot measure), and **Suggest marking** (local Ollama draft). Starting a class saves the marking plan first when worksheets and a task are present; a task the user has typed is never replaced by a server-drafted plan. In Running the text box is locked; in Result, sending a new task starts a new class.
- **Agents.** Three agents, one per backend worker desk in order: **Circle** (Atlas), **Star** (Nova) and **Triangle** (Orbit). Each is a flat illustration of the character on a bench with a laptop (`public/agents/<name>-rest.png` and `<name>-work.png`). Chart colours: Circle `#c8553d`, Star `#d9a300`, Triangle `#2a78d6`, validated as one categorical set; identity is also carried by names in the legend, line-end labels and the table.
- **Display-only agents.** **Cloud**, **Cube** and **Cylinder** also appear in the classroom with their own switches (off by default). They are for display only: they are not connected to the backend, never answer questions, and never appear in the chart, table or recommendation. Their tiles read "Display only · not connected"; when on, they show the working image and a "Display only" chip during and after a run.
- **On/off switches.** In Setup each agent has a switch instead of a dropdown. Off shows the resting image (Circle asleep, Star listening to music, Triangle asleep); on shows the working image. At least one of Circle, Star and Triangle must stay on. Choices are remembered per browser. Switched-off agents are left out of the live chart, the results table, the overall score (which is relative to the agents in class) and the recommendation; they are hidden from the classroom during and after the run. The backend still runs all three workers, so in Real models mode a switched-off agent still makes API calls.
- **Agent images by screen.** Setup shows every agent: the resting image when switched off, the still work image when on. Once a class starts, only switched-on agents are shown (including any display-only agents that are on). Running uses each agent's animated GIF (`public/agents/<name>.gif`) from the moment the class starts until results load; viewers who prefer reduced motion get the still work image instead. Result shows the still work image. Running tiles carry a status chip (Part A, Part B, Checking, Marking, or Display only); Result tiles show accuracy and a "Top of class" label on the recommended agent. The recommendation card shows the recommended agent's work image.
- **Setup screen.** Large agent tiles in a single row.
- **Running screen.** Agent tiles shrink into a compact grid on the left so the live chart takes the right side. Folder tabs above the chart choose the aspect to inspect: Accuracy, Efficiency, Speed, Cost, Overall. Each point is a running total after each marked part (A = 10 public questions, B = 10 holdout questions); lines are labelled by agent name at their ends. A progress bar shows quiz and phase.
- **Result screen.** Agents stay compact on the left with a plain-language recommendation below them (adjustable "good enough" accuracy threshold). On the right, **Live chart** and **Final results** are both collapsible drawers; the chart starts closed and the results table starts open. The table lists grade (A–F from accuracy), overall, accuracy, correct per 1,000 tokens, time per question, and estimated cost. Selecting an agent opens its latest marked answers (10 per part, times the number of repeats, each repeat labelled), with consistency and error stats when available: same answer on every repeat, valid numbers, average error, and bias (answer minus key) for numeric marking. **One more quiz** runs another round while unused questions remain.
- **Recommendation rule.** Among agents that reach the accuracy threshold, the highest overall score wins; ties go to the lower estimated cost. If none qualify, the most accurate agent is shown as "came closest", with overall score as the tie-break.
- **Removed from the interface.** Trader leaderboard, share prices, market activity feed, market analyst panel, and Solana receipt button. The backend still runs its trading, settlement, and analyst phases inside each round; the UI shows the trading phase as "Checking" and settlement as "Marking".

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
4. Separate measured worker performance from evaluator judgment and from the backend's virtual-market simulation.
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
- Optional Phantom-signed Solana Devnet receipts for completed rounds (backend API only; no longer shown in the interface).
- Classroom interface with selectable agent characters, a live per-aspect chart, collapsible results, and per-agent answer inspection.
- Worksheet library: add files of many types, keep them between classes, and combine several into one benchmark.
- Repeat trials (1–5) per question with answer-stability and numeric-error diagnostics.

## Constraints and Honest Boundaries

- The application is a local, single-user prototype without authentication or user isolation.
- Worksheets are fixed once a class has started; start a new class to change them. Converted worksheets depend on Gemini and may contain worked-out answers that need checking.
- At least 20 distinct examples are required, with 20 consumed per round.
- The importer catches exact duplicate questions but cannot detect semantic leakage or low-quality references.
- Rubric grading is an estimate from a local judge model and requires calibration against human ratings.
- Generated-item scoring measures distinct valid strings, not originality, mathematical quality, or curriculum suitability.
- Provider token counts are not directly comparable tokenizers or verified invoices.
- Demo mode is simulated and cannot support claims about real model quality.
- The backend's virtual market still runs each round (adding trader and analyst calls in live mode) but is hidden from the interface and is not financial trading.
- Switching an agent off only hides it from the comparison; the backend still runs and bills all three workers.
- Chart points update after each batch of 10 questions, not after each question.
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
2. Remove the trading and analyst phases from the backend round now that the interface no longer shows them.
3. Let the on/off switches skip workers in the backend run, and let users pick the model behind each agent (requires backend changes).
4. Add stronger educational metrics, such as method correctness and error-category breakdowns.
5. Validate Ollama rubric scores against teacher judgments before using them for recommendations.
