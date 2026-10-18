// Compare only matched batches with usage metadata for every worker.
export function modelMetrics(workers, round = null, countItems = false) {
  const histories = workers.map(w => (w.scores || []).filter(s => round === null || s.round === round));
  const keys = histories[0]?.filter(s => histories.every(h => h.some(t => t.round === s.round && t.stage === s.stage && t.total_tokens > 0 && t.elapsed_seconds > 0 && t.attempted > 0 && (!countItems || (Number.isFinite(t.output_count) && t.output_count >= 0))))).map(s => `${s.round}:${s.stage}`) || [];
  const rows = workers.map((w, i) => {
    const samples = histories[i].filter(s => keys.includes(`${s.round}:${s.stage}`));
    const sum = key => samples.reduce((total, s) => total + s[key], 0);
    const correct = sum('correct'), tokens = sum('total_tokens'), seconds = sum('elapsed_seconds'), attempted = sum('attempted');
    const outputCount = countItems ? sum('output_count') : correct;
    const priced = samples.length > 0 && samples.every(s => Number.isFinite(s.estimated_cost_usd) && s.estimated_cost_usd >= 0);
    const costPer1k = priced && tokens ? sum('estimated_cost_usd') * 1000 / tokens : null;
    return { ...w, costPer1k, attempted, correct, outputCount, tokens, seconds, efficiency: tokens ? outputCount * 1000 / tokens : null, speed: attempted ? seconds / attempted : null, throughput: seconds ? outputCount / seconds : 0 };
  });
  const maxEfficiency = Math.max(0, ...rows.map(w => w.efficiency || 0));
  const maxThroughput = Math.max(0, ...rows.map(w => w.throughput));
  return rows.map(w => ({ ...w, overall: w.attempted ? 100 * Math.sqrt((maxEfficiency ? w.efficiency / maxEfficiency : 0) * (maxThroughput ? w.throughput / maxThroughput : 0)) : null }));
}

export function metricLeaders(rows, key) {
  const eligible = rows.filter(w => w[key] !== null && (key === 'speed' || w.correct > 0));
  if (!eligible.length) return [];
  const best = (key === 'speed' ? Math.min : Math.max)(...eligible.map(w => w[key]));
  return eligible.filter(w => Math.abs(w[key] - best) < 1e-9);
}

export function fastestQualified(rows, minimumAccuracy) {
  return metricLeaders(rows.filter(w => w.attempted > 0 && 100 * w.correct / w.attempted >= minimumAccuracy), 'speed');
}

export const ASPECTS = {
  accuracy: { label: 'Accuracy', unit: '%', better: 'higher', hint: 'Share of answers marked correct.' },
  efficiency: { label: 'Efficiency', unit: 'correct / 1k tokens', better: 'higher', hint: 'Correct answers per 1,000 tokens used.' },
  speed: { label: 'Speed', unit: 's / question', better: 'lower', hint: 'Average seconds spent per question.' },
  cost: { label: 'Cost', unit: 'USD', better: 'lower', hint: 'Estimated spend so far, from configured token prices.' },
  overall: { label: 'Overall', unit: '/ 100', better: 'higher', hint: 'Efficiency and throughput combined, relative to the best student.' },
};

// Add accuracy and total estimated cost to the shared modelMetrics rows.
export function withAspects(rows) {
  return rows.map(w => {
    const samples = w.scores || [];
    const sum = key => samples.reduce((n, s) => n + (s[key] || 0), 0);
    const priced = samples.length > 0 && samples.every(s => Number.isFinite(s.estimated_cost_usd));
    // Accuracy counts every graded batch, even ones without token usage.
    return { ...w, gradedCorrect: sum('correct'), gradedAttempted: sum('attempted'),
      accuracy: sum('attempted') ? 100 * sum('correct') / sum('attempted') : null,
      cost: priced ? sum('estimated_cost_usd') : null };
  });
}

// One point per finished batch; each point is the running total up to that batch.
export function cumulativeSeries(workers, aspect, countItems = false) {
  const batches = workers[0]?.scores || [];
  return batches.map((batch, i) => {
    const sliced = workers.map(w => ({ ...w, scores: (w.scores || []).slice(0, i + 1) }));
    const rows = withAspects(modelMetrics(sliced, null, countItems));
    return { label: `Round ${batch.round}${batch.stage === 'reveal' ? ' · B' : ''}`, ...Object.fromEntries(rows.map(w => [w.id, w[aspect]])) };
  });
}

// Prefer the strongest overall student that clears the bar; cost breaks near-ties.
export function recommend(rows, minimumAccuracy) {
  const measured = rows.filter(w => w.accuracy !== null);
  if (!measured.length) return null;
  const qualified = measured.filter(w => w.accuracy >= minimumAccuracy);
  const pool = qualified.length ? qualified : measured;
  // Qualified: best overall wins. Nobody qualified: closest on accuracy, then overall.
  const keys = w => qualified.length ? [w.overall ?? w.accuracy, 0] : [w.accuracy, w.overall ?? 0];
  const best = [...pool].sort((a, b) => {
    const [a1, a2] = keys(a), [b1, b2] = keys(b);
    return b1 - a1 || b2 - a2 || (a.cost ?? Infinity) - (b.cost ?? Infinity);
  })[0];
  return { worker: best, qualified: qualified.length > 0 };
}

export const letterGrade = accuracy => accuracy === null ? '—' : accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : accuracy >= 60 ? 'D' : 'F';
