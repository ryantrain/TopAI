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
