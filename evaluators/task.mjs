import { countriesSourceSha256, evaluateCountriesRun } from './countries.mjs';

export async function evaluateTaskRun(runRecord) {
  if (['FE-01', 'FE-03'].includes(runRecord.taskId)
    && runRecord.taskSource?.sha256 === countriesSourceSha256) return evaluateCountriesRun(runRecord);
  return null;
}
