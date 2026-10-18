# Dynamic benchmarks

A dataset is a collection of test cases. A benchmark specification defines what counts as success for those cases. The app now saves both together.

1. Describe the job and what matters: for example, “Find a consistent paper grader; compare with human marks and measure whether it grades too harshly.”
2. Click **Build benchmark execution plan**. Local Ollama receives the full goal and available backend operations. With a dataset uploaded it also receives the name, size, reference type, existing task instructions, and up to three bounded question samples. Reference answers are not sent to the planner. Paper grading has a template that the planner adapts to the full request; it no longer bypasses planning with a keyword-only parser.
3. Review **How this benchmark will run**. Expand **Review or edit backend execution plan** for the complete JSON string. This is an executable configuration, not another prompt sent to workers.
4. Upload real question/reference pairs and save the plan. If you drafted before uploading, build again to account for the uploaded dataset. Unsupported requirements appear in the draft and block saving until addressed.
5. Run a live benchmark. The backend follows the saved selection, repetitions, scoring, tolerance, threshold, and worker instructions. Each model answers a batch of 10 questions, then Gemini grades that batch of answers in one call using the saved criteria. References remain out of worker prompts.
6. Inspect worker details for individual trials, repeat agreement, numeric error/bias, and Gemini's reason for each verdict. Plans and measurements persist in the local database and round archives. Changing the plan requires a new session.

## Executable plan contract

`execution_spec` is a JSON string compiled and validated by `BenchmarkPlan` when saved. Its settings override any conflicting legacy top-level scoring fields. Unknown JSON operations, invalid repetitions, incompatible references, and malformed plans are rejected before running. The stored plan includes the canonical string and validated fields consumed by the runner. Existing saved plans continue with sequential selection and one repetition unless configured otherwise.

```json
{
  "procedure": "Shuffle the uploaded papers reproducibly. Grade the same ten papers in three separate calls per model. Compare every mark with the human reference. Report pass rate, mean absolute mark error, signed grading bias, and exact repeat agreement. Reserve a disjoint ten-paper batch for settlement.",
  "selection": "shuffled",
  "repetitions": 3,
  "unsupported_requirements": [],
  "method": "numeric",
  "output_unit": "answers",
  "instructions": "Grade each supplied paper using its assignment and marking rubric. Return only its total numeric mark on the supplied scale.",
  "rubric": "",
  "tolerance": 1,
  "pass_score": 80
}
```

- `selection`: `sequential` or `shuffled`. Shuffling uses a fixed dataset-derived seed, without mutating the uploaded order. Public and settlement batches remain disjoint, and all models see the same examples.
- `repetitions`: 1–5 separate calls per model on the same ten examples per stage. Every round uses 20 unique examples and `6 × repetitions` worker calls, plus the same number of Gemini evaluator calls (one per model per stage per attempt, each grading 10 answers). Repetitions multiply inference usage; worker tokens and time are summed across attempts. Scores are normalized over every attempted answer.
- `method`, `tolerance`, `pass_score`, `rubric`: control actual grading. The need is used by the planner and passed to Gemini as evaluation context; it is no longer appended to worker prompts. Only `instructions` and existing dataset task instructions describe the worker's job.
- `procedure`: explains the experiment for review. It does not execute arbitrary prose or rewrite Python. Changing backend behavior requires changing the validated settings. Additional algorithms require backend implementation.
- `unsupported_requirements`: planner-reported measurements the backend cannot perform. Nonempty lists block saving; this is an LLM assessment, not proof that all needs were captured.

Repeated runs report the percentage of examples with exactly matching outputs across every trial, ignoring JSON object key order. This is output stability, not semantic consistency. Numeric runs also report valid numeric count, mean absolute error, and mean signed error (`response − reference`): positive bias means higher marks, negative means lower. Invalid numeric responses fail scoring and are excluded from error averages, with the valid count displayed. All diagnostics are descriptive; the market still settles using the configured pass percentage. Demo diagnostics are simulated.

The planner can assemble supported experiments and evaluation criteria. It cannot add tools, generate authoritative answer keys, execute arbitrary code, or silently implement new scoring algorithms. Qualitative originality/usefulness can be judged by Gemini against your criteria, but objective semantic novelty or population fairness measurements require additional backend support.

## Who decides correctness

There is one evaluator: Gemini. The previous arrangement — a separate judge agent per scoring method, plus deterministic Python comparison — is gone. Every agent answer goes to Gemini with the question and the reference answer, and Gemini returns correct or not correct plus a short reason. Answers travel in batches of 10 per agent, not one request per answer.

| Stage | Who runs it |
| --- | --- |
| Turning the user's request into benchmark metrics | Local Ollama, once, before the run |
| Answering each batch of 10 questions | The 3 demo agents, concurrently |
| Deciding whether an answer is correct | Gemini, one batched call per agent per stage |
| Counting distinct generated items | Python (a count, not a verdict) |
| Storing the verdict and updating the graph and metrics | Python backend |

The goal is compiled into explicit execution settings and scoring criteria. Review those settings before saving; prose alone does not change the runner. Python never executes generated code or uploaded scripts.

The saved criteria (task instructions, tolerance, pass threshold, scoring notes) are passed to Gemini as context for its verdict. They no longer select a different evaluator or a different code path. Python does not re-compare the answer itself, and never executes generated code or uploaded scripts.

Because Gemini is the only evaluator, its verdicts are the measurement. There is no second opinion and no deterministic fallback.

Reference answers can be numbers, text, or JSON text in the dataset’s `answer` field. Gemini is told the saved tolerance for numeric tasks and is asked to treat formatting differences, equivalent phrasings, and equivalent structures as correct. That flexibility is the point of using a model, and it is also why two runs over the same data can disagree on borderline answers.

Each verdict carries a short reason, shown in the worker details. The market score and accuracy columns are the percentage of answers Gemini marked correct. Timing and token counts measure the demo agents only; Gemini's own latency and tokens are excluded. If Gemini fails or returns something unusable for an answer, that answer is not silently marked correct or incorrect — the run surfaces the error instead of inventing a verdict.

## Run locally

Grading needs `GEMINI_API_KEY` set in `.env`, since Gemini decides every verdict. A live run with saved criteria refuses to start without it, so no paid worker calls are wasted on a run that could not be graded. The benchmark plan fields can be filled in manually without Ollama.

For drafting the metrics, install Ollama separately, start its server on `127.0.0.1:11434`, and download a local model with `ollama pull MODEL_NAME`. Set `OLLAMA_MODEL` in the application’s `.env`. The default example is `qwen2.5:7b`; choose installed models appropriate to your hardware. The app does not install or download them automatically. There is no `OLLAMA_JUDGE_MODEL` any more — Ollama no longer grades anything.

To keep the three demo agents local (grading still goes to Gemini), configure the worker roles:

```dotenv
WORKER_PROVIDERS=ollama,ollama,ollama
# Replace these three names with actual installed models from `ollama list`.
WORKER_MODELS=YOUR_FIRST_MODEL,YOUR_SECOND_MODEL,YOUR_THIRD_MODEL
TRADER_PROVIDER=ollama
ANALYST_PROVIDER=ollama
OLLAMA_MODEL=YOUR_LOCAL_DEFAULT_MODEL
# Leave blank to use OLLAMA_MODEL for these roles:
TRADER_MODEL=
ANALYST_MODEL=
# Required: Gemini decides whether every answer is correct.
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.0-flash
```

Restart the backend after changing `.env`. Use a custom dataset to avoid the built-in GSM8K download. Select **Live** to run real local inference; **Demo** continues to simulate results. `GEMINI_API_KEY` is required for any live run, because evaluation is no longer local.

Local-only operation is no longer possible for a full benchmark, since every verdict is a Gemini call. To keep Ollama itself from reaching its own cloud while it drafts metrics, disable cloud features in the **Ollama server**, using `OLLAMA_NO_CLOUD=1` or `disable_ollama_cloud` in its `server.json`, then restart Ollama. Setting that variable only in this app’s `.env` does not configure an already-running Ollama server. See [Ollama’s privacy and local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features). The app uses Ollama’s [local JSON chat API](https://docs.ollama.com/api/chat), never a user-supplied remote endpoint. Cloud-named models are rejected.

The start endpoint checks that required local models are installed before issuing paid worker calls. This is a readiness check, not a guarantee that inference will fit in memory or produce valid results. Local inference has a five-minute request timeout.

## Evidence and limits

- Keep human reference answers: arbitrary unlabelled files do not become reliable benchmarks automatically. This version does not generate a supposedly authoritative answer key.
- Gemini's verdicts are estimates, not ground truth, and they are now the only evaluator. There is no deterministic comparison left to cross-check them against, so calibrate on manually graded examples before trusting any ranking.
- Do not configure Gemini as one of the three demo agents. It would be grading its own answers, and self-judging can favor its own style.
- Grading requires network calls to Gemini (6 per round). The benchmark cannot run offline, a Gemini outage fails the round, and agent answers plus reference answers are sent to Google.
- One malformed batch costs all 10 of that agent's verdicts for the stage, and the round is rolled back rather than part-graded.
- Changing a task specification requires a new session. All workers receive identical task instructions when a plan is saved; worker persona differences are not added to custom tasks.
- Scores apply to the dataset and criteria you curated, not every task in that niche. The current importer checks duplicate questions; it cannot detect paraphrases or semantic overlap between public and holdout examples.
- Model tags can change after downloading an update. Keep the same installed model versions when comparing runs.
- Worker calls run concurrently. Local queueing, model loading, hardware contention, and warm-up affect observed wall time; measure on consistent hardware and repeat runs before drawing speed conclusions.
- Evaluation is now a hosted model call. No embedding service or dynamic code execution was added. Optional Solana receipts still require a network request if used.

## Example: “I want the best one for grading papers”

The text box is available before upload. The planner uses a paper-grading template with shuffled examples and three repeated calls, adapting it to the full request. For numeric human marks it can choose numeric agreement; for written feedback it can choose rubric evaluation. Review the generated execution plan and tolerance before saving. The runner then carries out the saved settings rather than passing the original benchmark-selection request to the tested models.

Upload the real papers, assignment prompts, and marking criteria as questions and human-assigned marks as reference answers. Review and save the plan to that dataset. The three demo agents then actually grade these papers; they do not take a general math benchmark. Gemini compares each agent's mark or feedback to the human reference and decides whether it counts as correct. The app does not fabricate student papers or ground-truth human marks from the request alone.

## Saved criteria and task metrics

After a successful save, the panel displays **Execution plan saved**, the dataset,
scoring method, and server save time. Edits display **Unsaved changes** until saved. Editing the need clears its draft plan so it must be rebuilt.
The persisted plan survives page reloads. Replacing the dataset requires saving its
criteria again; a new session clears the active dataset and plan.

For math, keep exact or numeric scoring: efficiency remains correct answers per
1,000 total provider tokens. For brainstorming, choose **Count distinct generated
items** and name the **Output items to count** (for example, ideas or test cases).
Each worker answer must be a JSON array of nonempty strings. The evaluator counts
unique strings within each answer after normalizing case and whitespace. Efficiency
is total counted items / total tokens × 1,000; overall combines items/token and
items/second. The separate format pass rate is the percentage of responses with at
least one item. Counts measure quantity, not semantic uniqueness, relevance, or
originality. Dataset files still require 20–2,000 distinct questions and an answer
field; reference answers are not used by item counting. Demo item counts, tokens,
and timing are simulated. Live behavior can be verified without paid API calls by
mocking both the worker responses and the Gemini verdicts in
backend.test_evaluation.
