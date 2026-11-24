const groups = {
  'FE-01': { functionality: ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04',
    'FE01-F05', 'FE01-F06', 'FE01-F07', 'FE01-F08'],
    accessibility: ['FE01-A01'], gates: ['FE01-T01', 'FE01-T02'] },
  'FE-03': { functionality: ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04',
    'FE01-F05', 'FE01-F06', 'FE01-F07', 'FE01-F08'],
    accessibility: ['FE01-A01'], gates: ['FE01-T01', 'FE01-T02'] },
};

export const qualityWeights = Object.freeze({ functionality: 40, accessibility: 15, static: 20, aiCode: 25 });

function groupScore(checks, ids) {
  const observed = ids.map((id) => checks.find((item) => item.id === id)?.status ?? 'not_evaluated');
  return observed.every((status) => status === 'pass' || status === 'fail')
    ? Math.round(observed.filter((status) => status === 'pass').length / ids.length * 10000) / 100 : null;
}

export function gradeFullQuality(taskId, assessment, staticResult, aiResult) {
  const group = groups[taskId];
  if (!group) throw new Error(`No full quality rubric for ${taskId}`);
  const checks = assessment?.checks ?? [];
  const categories = {
    functionality: groupScore(checks, group.functionality),
    accessibility: groupScore(checks, group.accessibility),
    static: staticResult?.score ?? null,
    aiCode: aiResult?.status === 'evaluated' ? aiResult.score : null,
  };
  const complete = Object.values(categories).every(Number.isFinite)
    && group.gates.every((id) => checks.some((item) => item.id === id && ['pass', 'fail'].includes(item.status)));
  const score = complete ? Math.round(Object.entries(qualityWeights)
    .reduce((sum, [key, weight]) => sum + categories[key] * weight / 100, 0) * 100) / 100 : null;
  const mandatoryPassed = categories.functionality === 100 && group.gates.every((id) => checks.some((item) => item.id === id && item.status === 'pass'))
    && staticResult?.typescript?.pass === true && staticResult?.eslint?.pass === true;
  return { scope: 'full_quality', rubricVersion: 1, weights: qualityWeights, categories,
    complete, score, mandatoryPassed, passed: complete && mandatoryPassed && score >= 90,
    threshold: 90, visual: { status: 'not_evaluated', includedInScore: false } };
}
