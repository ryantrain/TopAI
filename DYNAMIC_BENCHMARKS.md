# Dynamic benchmarks

A dataset is a collection of test cases. A benchmark specification defines what counts as success for those cases. The app now saves both together.

1. Use the visible task text box before or after uploading at least 20 distinct question/reference-answer pairs.
2. Describe the specific job, such as “summarize support tickets in two sentences, keeping the issue and requested action without inventing facts.”
3. Click **Build benchmark from my request**. Paper-grading requests have a built-in local parser that needs no model server. Other requests use local Ollama, or you can fill in the specification manually. With a dataset uploaded, the planner receives its name, size, reference type, existing task instructions, and up to three bounded question samples. Evaluation answer keys are not sent to the planner. A draft entered before upload is retained when you upload; click Build again to tailor it to the new dataset.
4. Review the shared task instructions, the metrics, the tolerance, and the pass threshold; save them explicitly. These become the context Gemini uses when it checks answers.
5. Run a live benchmark. It proceeds in batches of 10 questions:
   - the batch of 10 goes to all three demo agents at once, with the same task instructions and no reference answers; each agent answers all 10 in a single call;
   - each agent's 10 answers then go to Gemini in a single call, together with the questions and reference answers, and Gemini returns a verdict and reason for each;
   - the Python backend stores the 30 verdicts and updates the stored state, the UI graph, and the metrics;
   - a round runs two such stages, 10 public questions then 10 unused holdout questions. That is 6 Gemini calls per round, 3 of them concurrent, which is deliberate: grading one answer per call would multiply requests tenfold and run into rate limits.
   Existing dataset-level instructions are also sent to workers, so keep evaluation answer keys out of those instructions.
6. Inspect individual answers and Gemini's reason for each verdict. Criteria, reference answers, model configuration, and results persist in the local database and round archives. Criteria cannot change after the first round starts.

## Who decides correctness

There is one evaluator: Gemini. The previous arrangement — a separate judge agent per scoring method, plus deterministic Python comparison — is gone. Every agent answer goes to Gemini with the question and the reference answer, and Gemini returns correct or not correct plus a short reason. Answers travel in batches of 10 per agent, not one request per answer.

| Stage | Who runs it |
| --- | --- |
| Turning the user's request into benchmark metrics | Local Ollama, once, before the run |
| Answering each batch of 10 questions | The 3 demo agents, concurrently |
| Deciding whether an answer is correct | Gemini, one batched call per agent per stage |
| Counting distinct generated items | Python (a count, not a verdict) |
| Storing the verdict and updating the graph and metrics | Python backend |

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

The text box is available before upload. Ollama turns the request into worker instructions to grade actual papers against the supplied assignment and marking criteria, plus the tolerance for numeric marks. Your original request remains part of every worker’s instructions, including any extra constraints.

Upload the real papers, assignment prompts, and marking criteria as questions and human-assigned marks as reference answers. Review and save the plan to that dataset. The three demo agents then actually grade these papers; they do not take a general math benchmark. Gemini compares each agent's mark or feedback to the human reference and decides whether it counts as correct. The app does not fabricate student papers or ground-truth human marks from the request alone.

## Saved criteria and task metrics

After a successful save, the criteria panel displays **Criteria saved**, the dataset,
scoring method, and server save time. Edits display **Unsaved changes** until saved.
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
