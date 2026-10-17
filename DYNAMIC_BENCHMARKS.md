# Dynamic benchmarks

A dataset is a collection of test cases. A benchmark specification defines what counts as success for those cases. The app now saves both together.

1. Use the visible task text box before or after uploading at least 20 distinct question/reference-answer pairs.
2. Describe the specific job, such as “summarize support tickets in two sentences, keeping the issue and requested action without inventing facts.”
3. Click **Build benchmark from my request**. Paper-grading requests have a built-in local parser that needs no model server. Other requests use local Ollama, or you can fill in the specification manually. With a dataset uploaded, the planner receives its name, size, reference type, existing task instructions, and up to three bounded question samples. Evaluation answer keys are not sent to the planner. A draft entered before upload is retained when you upload; click Build again to tailor it to the new dataset.
4. Review the shared task instructions, scoring method, rubric, and pass threshold; save them explicitly.
5. Run a live benchmark. Every worker gets the same questions and task instructions. The reference answers stay out of worker prompts. Existing dataset-level instructions are also sent, so keep evaluation answer keys out of those instructions.
6. Inspect individual answers and judge explanations. Criteria, reference answers, model configuration, and results persist in the local database and round archives. Criteria cannot change after the first round starts.

## Which evaluator?

| Need | Evaluator | Where scoring runs |
| --- | --- | --- |
| Classification, labels, exact answers | Exact match; trims surrounding whitespace, case-sensitive | Python |
| Numerical predictions or agreement with human marks | Absolute numeric tolerance chosen by the user | Python |
| Structured extraction with a known JSON reference | Structural equality; ignores object key order, preserves arrays and types | Python |
| Summaries, writing, semantic correctness, custom qualitative requirements | User-approved rubric, local judge score and explanation | Ollama on localhost |

The free-text goal guides model instructions and the suggested rubric; it does not secretly change the scoring algorithm. For objective criteria, choose an explicit evaluator. For qualitative goals, review the generated rubric before saving. Python never executes generated code or uploaded scripts.

For JSON evaluation, store the reference as JSON text in the dataset’s `answer` field (escape it inside a JSON dataset). Responses can contain actual JSON objects or JSON text. Numeric comparisons use the saved tolerance, overriding the original dataset tolerance for that plan.

Rubric evaluation grades each response from 0–100 using the saved goal, rubric, question, and reference answer. The market score and comparison accuracy columns use the percentage meeting the saved pass threshold, not the average raw judge score. Scores and explanations appear in worker details. Inference timing and tokens measure workers only; judge overhead is excluded. Failures or malformed judge results fail the round instead of awarding invented grades.

## Run locally

Objective grading needs no new dependencies or model server. You can configure those fields manually without Ollama.

For drafting and subjective grading, install Ollama separately, start its server on `127.0.0.1:11434`, and download a local model with `ollama pull MODEL_NAME`. Set `OLLAMA_MODEL` and optionally `OLLAMA_JUDGE_MODEL` in the application’s `.env`. The default example is `qwen2.5:7b`; choose installed models appropriate to your hardware. The app does not install or download them automatically.

To keep the entire benchmark local, configure all roles:

```dotenv
WORKER_PROVIDERS=ollama,ollama,ollama
# Replace these three names with actual installed models from `ollama list`.
WORKER_MODELS=YOUR_FIRST_MODEL,YOUR_SECOND_MODEL,YOUR_THIRD_MODEL
TRADER_PROVIDER=ollama
ANALYST_PROVIDER=ollama
OLLAMA_MODEL=YOUR_LOCAL_DEFAULT_MODEL
OLLAMA_JUDGE_MODEL=YOUR_LOCAL_JUDGE_MODEL
# Leave blank to use OLLAMA_MODEL for these roles:
TRADER_MODEL=
ANALYST_MODEL=
```

Restart the backend after changing `.env`. Use a custom dataset to avoid the built-in GSM8K download. Select **Live** to run real local inference; **Demo** continues to simulate results. No provider API keys are required when all roles use Ollama. Configuring just the judge as local still sends worker questions to any configured cloud workers.

For local-only operation, also disable cloud features in the **Ollama server**, using `OLLAMA_NO_CLOUD=1` or `disable_ollama_cloud` in its `server.json`, then restart Ollama. Setting that variable only in this app’s `.env` does not configure an already-running Ollama server. See [Ollama’s privacy and local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features). The app uses Ollama’s [local JSON chat API](https://docs.ollama.com/api/chat), never a user-supplied remote endpoint. Cloud-named models are rejected.

The start endpoint checks that required local models are installed before issuing paid worker calls. This is a readiness check, not a guarantee that inference will fit in memory or produce valid results. Local inference has a five-minute request timeout.

## Evidence and limits

- Keep human reference answers: arbitrary unlabelled files do not become reliable benchmarks automatically. This version does not generate a supposedly authoritative answer key.
- Local judges are estimates, not ground truth. Calibrate on manually graded examples before trusting rankings. Use a separate judge model where possible; self-judging can favor its own style.
- Changing a task specification requires a new session. All workers receive identical task instructions when a plan is saved; worker persona differences are not added to custom tasks.
- Scores apply to the dataset and rubric you curated, not every task in that niche. The current importer checks duplicate questions; it cannot detect paraphrases or semantic overlap between public and holdout examples.
- Model tags can change after downloading an update. Keep the same installed model versions when comparing runs.
- Worker calls run concurrently. Local queueing, model loading, hardware contention, and warm-up affect observed wall time; measure on consistent hardware and repeat runs before drawing speed conclusions.
- No hosted judge, embedding service, dynamic code execution, or additional Python/JavaScript dependency was added. Optional Solana receipts still require a network request if used.

## Example: “I want the best one for grading papers”

The text box is available before upload. The local parser recognizes paper/essay grading and creates worker instructions to grade actual papers against the supplied assignment and rubric. For numeric human marks it selects numeric agreement, using the dataset’s tolerance. If references are written feedback, or you explicitly request feedback/comments/explanations, it selects rubric evaluation instead. Your original request remains part of every worker’s instructions, including any extra constraints.

Upload the real papers, assignment prompts, and marking criteria as questions and human-assigned marks as reference answers. Review the allowed mark difference and save the plan to that dataset. Workers then actually grade these papers; they do not take a general math benchmark. The score measures agreement with human grades within your allowed error (or rubric pass rate for feedback). The app does not fabricate student papers or ground-truth human marks from the request alone.

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
mocking worker responses in backend.test_evaluation.
