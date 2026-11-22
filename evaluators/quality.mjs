const countriesObjectiveIds = [
  'FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04', 'FE01-F05',
  'FE01-F06', 'FE01-F07', 'FE01-F08', 'FE01-A01', 'FE01-T01', 'FE01-T02',
];

function gradeObjectiveAssessment(assessment, objectiveIds) {
  const checks = new Map(assessment?.checks?.map((item) => [item.id, item]) ?? []);
  const objective = objectiveIds.map((id) => checks.get(id) ?? { id, status: 'not_evaluated' });
  const evaluated = objective.every((item) => item.status === 'pass' || item.status === 'fail');
  const passes = objective.filter((item) => item.status === 'pass').length;
  const failed = objective.filter((item) => item.status === 'fail');
  return {
    scope: 'objective_diagnostic', complete: false,
    score: evaluated ? Math.round(passes / objective.length * 10000) / 100 : null,
    mandatoryPassed: evaluated && passes === objective.length,
    reason: 'Visual quality and code quality are not graded; a full completion score is unavailable',
    objectivePassed: passes, objectiveTotal: objective.length,
    feedback: failed.map((item) => ({ id: item.id,
      message: `Check failed. Evidence: ${JSON.stringify(item.evidence ?? {}).slice(0, 900)}` })),
  };
}

export function gradeCountriesAssessment(assessment) {
  return gradeObjectiveAssessment(assessment, countriesObjectiveIds);
}

export function gradeTaskAssessment(taskId, assessment) {
  if (['FE-01', 'FE-03'].includes(taskId)) return gradeCountriesAssessment(assessment);
  throw new Error(`No objective grader for task: ${taskId}`);
}
