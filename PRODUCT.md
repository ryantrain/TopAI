# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web application with a Next.js frontend (Agent Classroom) and a FastAPI backend.

## Product Summary

Agent Classroom (the backend is still named Agent Exchange) is a task-specific AI evaluation lab, framed as a classroom: the user is the teacher and the AI agents are students at their desks. A user describes what they need an AI model to do, turns their material into datasets, sets how answers are marked (optionally with a judge and rubric), and runs the same experiment against three worker agents. The product scores the results and identifies the strongest agent for that task based on accuracy, speed, token efficiency, and optional cost estimates.

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
6. Each agent's batch of answers goes to Gemini in a single call together with the reference answers. Gemini returns a correct / not correct verdict with a reason for each answer. Gemini is the only evaluator; there are no separate judge agents.
7. The Python backend stores the verdicts and updates the UI graph and metric panels.
8. Each further round draws the next unused batch, until the dataset is exhausted.
9. The dashboard shows the accumulated evidence and highlights the best-performing agent for this specific experiment.

## Interface

The frontend has two pages, linked from the sidebar's Dashboard menu: **Classroom** (`/`, where the agents work) and **Worksheets** (`/worksheets`, where material becomes question sets). The Classroom page has three states, chosen from backend state: **Setup** (no completed round yet), **Running** (a run is in progress), and **Result** (at least one round completed). A minimal classroom style is used throughout: neutral surfaces, navy and wood accents, no cartoon elements.

- **Layout.** A left sidebar (brand, Dashboard menu with Classroom and Worksheets, and, on Classroom, a New class button at the bottom) and a main workspace. On Classroom a chat-style composer is pinned to the bottom of the workspace on every screen.
- **Worksheets page.** A drop zone (drag and drop or browse, several files at once, up to 10 MB each) for PDFs, photos (PNG, JPG, WebP, HEIC), Word, PowerPoint, Excel, CSV, JSON and plain text. Each file goes to `POST /api/library/convert`: CSV and JSON with question and answer columns are imported as they are; everything else is read by Gemini, which extracts each question with its answer (from the file's answer key when there is one, otherwise worked out by the model). A progress list shows each file as waiting, reading, added (with the worksheet name and question count) or failed (with the reason). Below, **Your worksheets** lists every saved worksheet with a **Use** checkbox (sets the next class's selection via `PUT /api/library/selection`; several are merged), name and source file, how it was made (Read by AI or Imported), question count, answer type, a "N to check" flag for answers the AI worked out itself, date added, and actions: **Preview** (all questions and answers plus the agent instructions), **Download** (JSON in the importer's format) and **Remove**. The selection is fixed while a class is running or has results. A **Go to classroom** button returns to the main page.
- **Composer.** A text box for the task, a **+** button that opens the **Choose worksheets** menu, and an **↑** button (or Enter) that drafts the marking plan, then starts the class. The menu lists every saved worksheet: tick one or more to merge them into one question set, remove worksheets, or follow **Upload or manage worksheets** to the Worksheets page; it shows the question count, how many rounds it allows, and flags answers the converter worked out itself. There are no built-in sample questions in the interface: a class can't start until at least one worksheet is ticked. Uploading happens only on the Worksheets page. The hint line under the text box names the selected worksheets and how the run will go.
- **Run type.** There is no Practice / Real models control. If the backend has the provider API keys it needs, the class runs real models (and uses API credits); otherwise it runs a simulated practice run. The hint line says which.
- **Marking plan (Setup).** Typing a task and pressing **↑** sends it, with the selected worksheets as context, to `POST /api/benchmark/suggest`. Qwen (the local Ollama judge model) turns the plain-language task into a technical marking plan; with qwen3:8b on a laptop this takes about 40 seconds, longer if Ollama is busy with an earlier request (a skipped draft keeps running in the background until it finishes), so a "Writing the marking plan" card shows meanwhile, with **Skip, I'll fill it in** to open the panel with defaults instead. The plan then appears above the text box for review: **Evaluate using** (Exact answer / label, Numeric agreement, Structured JSON equality, Local rubric judge (Qwen), Count distinct generated items), the matching setting (**Passing judge score / 100**, **Allowed error (±)** or **Items to count**), and for the rubric judge a **Judge** row (Qwen is connected and shows its model once saved; Gemini, GPT and Claude are shown but not connected) and **Judge criteria** with presets (Maths equivalence, Short answers, Worked explanations, Grading papers). Also **Instructions every agent gets**, **Repeats** (1–5 answers per question, for consistency), **Rounds**, any requirements the plan says it cannot measure, and a short "How the test runs" summary. **Save benchmark criteria** stores the plan with `PUT /api/benchmark`; pressing **↑** afterwards starts the class (pressing ↑ before saving saves and starts in one go). **Redraft** asks Qwen again, and is labelled "Task changed · redraft" if the task was edited after drafting. If drafting fails (for example Ollama isn't running), the panel opens with defaults to fill in by hand. Changing worksheets after saving requires saving again. In Running the text box is locked; in Result, sending a new task starts a new class.
- **Agents.** Three agents, one per backend worker desk in order: **Circle** (Atlas), **Star** (Nova) and **Triangle** (Orbit). Each is a flat illustration of the character on a bench with a laptop (`public/agents/<name>-rest.png` and `<name>-work.png`). Chart colours: Circle `#c8553d`, Star `#d9a300`, Triangle `#2a78d6`, validated as one categorical set; identity is also carried by names in the legend, line-end labels and the table.
- **Display-only agents.** **Cloud**, **Cube** and **Cylinder** also appear in the classroom with their own switches (off by default). They are for display only: they are not connected to the backend, never answer questions, and never appear in the chart, table or recommendation. Their tiles read "Display only · not connected"; when on, they show the working image and a "Display only" chip during and after a run.
- **On/off switches.** In Setup each agent has a switch instead of a dropdown. Off shows the resting image (Circle asleep, Star listening to music, Triangle asleep); on shows the working image. At least one of Circle, Star and Triangle must stay on. Choices are remembered per browser. Switched-off agents are left out of the live chart, the results table, the overall score (which is relative to the agents in class) and the recommendation; they are hidden from the classroom during and after the run. The backend still runs all three workers, so in Real models mode a switched-off agent still makes API calls.
- **Agent images by screen.** Setup shows every agent: the resting image when switched off, the still work image when on. Once a class starts, only switched-on agents are shown (including any display-only agents that are on). Running uses each agent's animated GIF (`public/agents/<name>.gif`) from the moment the class starts until results load; viewers who prefer reduced motion get the still work image instead. Result shows the still work image. Running tiles carry a status chip (Part A, Part B, Checking, Marking, or Display only); Result tiles show accuracy and a "Top of class" label on the recommended agent. The recommendation card shows the recommended agent's work image.
- **Setup screen.** Large agent tiles in a single row.
- **Running screen.** Agent tiles shrink into a compact grid on the left so the live chart takes the right side. Folder tabs above the chart choose the aspect to inspect: Accuracy, Efficiency, Speed, Cost, Overall. Each point is a running total after each marked part (A = 10 public questions, B = 10 holdout questions); lines are labelled by agent name at their ends. The heading reads "Round N of M · phase" and a progress bar shows progress.
- **Result screen.** Agents stay compact on the left with a plain-language recommendation below them (adjustable "good enough" accuracy threshold). On the right, **Live chart** and **Final results** are both collapsible drawers; the chart starts closed and the results table starts open. When a judge marked the answers, a note above the table names the judge model and pass mark (or says the Practice run skipped the judge), and the Accuracy column is labelled Pass rate. The table lists grade (A–F from accuracy), overall, accuracy, correct per 1,000 tokens, time per question, and estimated cost. Selecting an agent opens its latest marked answers (10 per part, times the number of repeats, each repeat labelled), with consistency and error stats when available: same answer on every repeat, valid numbers, average error, and bias (answer minus key) for numeric marking. **One more round** runs another round while unused questions remain.
- **Recommendation rule.** Among agents that reach the accuracy threshold, the highest overall score wins; ties go to the lower estimated cost. If none qualify, the most accurate agent is shown as "came closest", with overall score as the tie-break.
- **Removed from the interface.** Trader leaderboard, share prices, market activity feed, market analyst panel, and Solana receipt button. The backend still runs its trading, settlement, and analyst phases inside each round; the UI shows the trading phase as "Checking" and settlement as "Marking".

## Reference Use Case: Integral Tests

The first supported product story is evaluating agents on integral mathematics. Suitable experiments include:

- solving definite integrals within a numeric tolerance;
- classifying integral techniques;
- producing structured solution data;
- producing worked solutions judged against teacher-authored criteria;
- generating sets of integral practice questions.

The user supplies the source material and reference answers. Ollama may propose how to describe the task, but it must not invent ground truth or silently commit benchmark criteria. Gemini may judge an answer against the user's reference, but it never supplies the reference itself.

## Evaluation Model

Each round grades one unused batch of questions, 20 by default and configurable from 1 to 50 in the saved plan. Every worker sees the same inputs. Reference answers remain outside worker prompts. A dataset should be a whole multiple of the batch size, because a trailing partial batch is never run.

Evaluation is a single mechanism: Gemini receives the question, the agent's answer, the reference answer, and the saved criteria, and decides whether the answer is correct. The previous set of selectable evaluation methods and judge agents is gone.

The saved criteria inform that decision rather than switching evaluators:

- task instructions describe what the agent was asked to produce;
- tolerance sets how close a numeric answer must be;
- the pass threshold sets how strict to be on open-ended or partially correct answers.

Ollama's role is confined to turning the user's request into those metrics before the run. Python's role is to store each verdict and update the interface.

Grading is batched to stay within Gemini's rate limits: one call per agent, carrying that agent's whole batch of answers, three calls in flight at a time, for 3 Gemini calls per round. The interface therefore advances once per round, not after each individual answer. The price chart is drawn when the batch is graded, on each trade, and at settlement.

The product reports accuracy or pass rate, elapsed time, provider-reported token efficiency, optional operator-supplied cost estimates, and an overall score relative to the selected lineup. Users can inspect individual questions, answers, and grading evidence.

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
- Gemini verdicts on every answer, requested as one batch per agent per round.
- Stage-by-stage UI updates driven by the Python backend.
- CSV, JSON, and JSONL imports with 20–2,000 examples.
- Three configurable worker slots using Ollama, Gemini, OpenAI, or Anthropic.
- A single Gemini-based evaluator covering numeric, exact, structured, and open-ended answers.
- One configurable question batch per round, across 1–10 rounds.
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
- Every verdict is a Gemini estimate. With no deterministic comparison left as a cross-check, accuracy figures require calibration against hand-graded examples before they support a recommendation.
- Gemini may rule inconsistently on borderline answers, so two runs over the same data can differ.
- Gemini must not be configured as one of the three demo agents; it would grade its own work.
- Evaluation sends questions, agent answers, and reference answers to Google. A fully offline run is not possible.
- A failed or malformed Gemini batch fails that whole 10-answer stage for that agent rather than one answer, and the round is rolled back; no partial verdicts are invented.
- Grading cost scales with the number of answers; the number of Gemini requests scales with agents and stages, at 6 per round.
- Rubric grading is an estimate from a local judge model and requires calibration against human ratings. Only the local Ollama judge is connected; the other judges in the panel are placeholders.
- Generated-item scoring measures distinct valid strings, not originality, mathematical quality, or curriculum suitability.
- Provider token counts are not directly comparable tokenizers or verified invoices.
- Demo mode is simulated and cannot support claims about real model quality.
- The virtual market is an exploratory visualization and is not financial trading.
- Solana records an optional digest after a round; state updates and settlement remain in Python.
- Results depend on the uploaded data, prompt, saved criteria, Gemini's judgment, model versions, and machine/provider conditions.

## Privacy and Safety

API keys remain in the backend environment. Cloud worker configurations send benchmark prompts to their providers. Evaluation always sends questions, agent answers, and reference answers to Gemini, so a run that must stay off third-party infrastructure is not supported in this version; the demo agents and planning can still be local, and trading and the round summary make no model calls at all. Users must have permission to process uploaded educational or student data and should remove identifying information when it is unnecessary for the experiment.

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
5. Validate Gemini's verdicts against teacher judgments before using them for recommendations, and surface disagreement rates in the interface.
