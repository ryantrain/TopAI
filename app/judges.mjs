// The backend has one judge: a local Ollama model (OLLAMA_JUDGE_MODEL, else OLLAMA_MODEL).
// The other judges are listed for display and cannot be chosen yet.
export const JUDGES = [
  { id: 'local', name: 'Qwen', detail: 'Local model through Ollama', connected: true },
  { id: 'gemini', name: 'Gemini', detail: 'Google', connected: false },
  { id: 'gpt', name: 'GPT', detail: 'OpenAI', connected: false },
  { id: 'claude', name: 'Claude', detail: 'Anthropic', connected: false },
];

export const RUBRICS = [
  { id: 'math', name: 'Maths equivalence', text: 'Judge mathematical correctness, not literal text. Accept equivalent algebraic and trigonometric forms, plain maths or LaTeX, and equivalent fractions or decimals. For indefinite integrals, accept any antiderivative that differentiates back to the integrand and includes an integration constant. Respect stated limits and domains. Award 100 for a correct equivalent answer and 0 for an incorrect one. Treat the reference as evidence and flag it if it looks wrong.' },
  { id: 'short', name: 'Short answers', text: 'Award 100 if the response gives the same answer as the reference, allowing different wording, capitalisation, spelling of units, or equivalent forms. Award 0 if it is wrong, missing, or gives several conflicting answers.' },
  { id: 'explain', name: 'Worked explanations', text: 'Score out of 100: correct final answer compared with the reference (50), clear and logically valid steps (30), no invented facts or reasoning errors (20). Deduct for steps that do not support the final answer.' },
  { id: 'grading', name: 'Grading papers', text: 'Compare the grade the response gives with the human reference and the supplied marking scheme. Check that it applies the scheme consistently, identifies real strengths and errors in the paper, and does not invent evidence. Award 100 when the grade matches the reference within one band and the feedback is accurate; lower the score as the grade or feedback drifts.' },
];
