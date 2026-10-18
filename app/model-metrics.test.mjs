import test from 'node:test';
import assert from 'node:assert/strict';
import { modelMetrics, metricLeaders, fastestQualified, withAspects, cumulativeSeries, recommend, letterGrade } from './model-metrics.mjs';
const worker = (name, correct, tokens, seconds) => ({ name, scores: [{ round: 1, stage: 'quiz', correct, total_tokens: tokens, elapsed_seconds: seconds, attempted: 10 }] });
test('different category winners and correctness-adjusted overall', () => {
  const rows = modelMetrics([worker('Efficient', 8, 100, 10), worker('Fast', 10, 200, 5), worker('Wrong', 0, 10, 1)]);
  assert.equal(metricLeaders(rows, 'efficiency')[0].name, 'Efficient');
  assert.equal(metricLeaders(rows, 'speed')[0].name, 'Wrong');
  assert.equal(metricLeaders(rows, 'overall')[0].name, 'Fast');
  assert.equal(rows[0].efficiency, 80);
  assert.equal(rows[0].speed, 1);
  assert.equal(rows[2].overall, 0);
});
test('missing usage excludes unmatched batches and ties remain ties', () => {
  assert.equal(modelMetrics([worker('A', 5, 100, 2), worker('B', 5, null, 2)])[0].overall, null);
  const rows = modelMetrics([worker('A', 5, 100, 2), worker('B', 5, 100, 2)]);
  assert.equal(metricLeaders(rows, 'overall').length, 2);
  assert.equal(modelMetrics([worker('A', 0, 100, 2)])[0].overall, 0);
  assert.deepEqual(metricLeaders(modelMetrics([worker('A', 0, 100, 2)]), 'overall'), []);
});
test('aggregate ratios use totals and selected round', () => {
  const a = worker('A', 5, 100, 2);
  a.scores.push({ round: 2, stage: 'quiz', correct: 10, total_tokens: 900, elapsed_seconds: 8, attempted: 10 });
  assert.equal(modelMetrics([a])[0].efficiency, 15);
  assert.equal(modelMetrics([a])[0].speed, 0.5);
  assert.equal(modelMetrics([a], 2)[0].speed, 0.8);
});
test('USD per 1,000 tokens uses weighted totals and requires complete pricing', () => {
  const a = worker('A', 5, 100, 2);
  a.scores[0].estimated_cost_usd = 0.001;
  a.scores.push({ round: 2, stage: 'quiz', correct: 5, attempted: 10, total_tokens: 900, elapsed_seconds: 2, estimated_cost_usd: 0.018 });
  assert.equal(modelMetrics([a])[0].costPer1k, 0.019);
  assert.equal(modelMetrics([worker('Unknown', 5, 100, 2)])[0].costPer1k, null);
  a.scores[1].estimated_cost_usd = null;
  assert.equal(modelMetrics([a])[0].costPer1k, null);
  a.scores.forEach(s => s.estimated_cost_usd = 0);
  assert.equal(modelMetrics([a])[0].costPer1k, 0);
});

test('fastest recommendation respects the required accuracy and ties', () => {
  const rows = modelMetrics([worker('Fast inaccurate', 6, 100, 1), worker('Qualified', 9, 100, 3), worker('Perfect', 10, 100, 5)]);
  assert.equal(fastestQualified(rows, 90)[0].name, 'Qualified');
  assert.equal(fastestQualified(rows, 100)[0].name, 'Perfect');
  assert.deepEqual(fastestQualified(modelMetrics([worker('Unmeasured', 0, null, 0)]), 90), []);
});

test('recommendation prefers qualified overall, else accuracy then overall', () => {
  const a = { ...worker('Slow', 8, 1000, 20), id: 'a' }, b = { ...worker('Quick', 8, 1000, 5), id: 'b' }, c = { ...worker('Weak', 5, 100, 1), id: 'c' };
  const rows = withAspects(modelMetrics([a, b, c]));
  assert.equal(recommend(rows, 80).worker.name, 'Quick');
  assert.equal(recommend(rows, 80).qualified, true);
  const none = recommend(rows, 90);
  assert.equal(none.qualified, false);
  assert.equal(none.worker.name, 'Quick');
  assert.equal(recommend([], 80), null);
});
test('cumulative series keeps running accuracy per batch', () => {
  const a = { id: 'a', scores: [{ round: 1, stage: 'quiz', correct: 10, attempted: 10, total_tokens: 100, elapsed_seconds: 1 }, { round: 2, stage: 'quiz', correct: 0, attempted: 10, total_tokens: 100, elapsed_seconds: 1 }] };
  const rows = cumulativeSeries([a], 'accuracy');
  assert.deepEqual(rows.map(r => r.a), [100, 50]);
  assert.deepEqual(rows.map(r => r.label), ['Quiz 1', 'Quiz 2']);
  assert.equal(letterGrade(85), 'B');
  assert.equal(letterGrade(null), '—');
});

test('task metric averages weight measured examples, preserve zero, and omit missing values', () => {
  const scores = [
    { diagnostics: { task_metric_count: 10, task_metric_mean: 0 } },
    { diagnostics: { task_metric_count: 5, task_metric_mean: 6 } },
    { diagnostics: { task_metric_count: 0, task_metric_mean: null } },
  ];
  assert.equal(withAspects([{ scores }])[0].taskMetric, 2);
  assert.equal(withAspects([{ scores: [] }])[0].taskMetric, null);
});
