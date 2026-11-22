import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectRoot, readJson, writeJsonAtomic } from '../bootstrap/common.mjs';
import { archiveWorktree } from './storage.mjs';

export function environmentDirectory(options, environmentId, repetition) {
  return options.repeats === 1 ? environmentId : path.join(environmentId, `repeat-${String(repetition).padStart(2, '0')}`);
}

export async function createUserChecklist(options, result) {
  const commands = options.environments.flatMap((environment) => Array.from({ length: options.repeats }, (_, index) => {
    const repeat = options.repeats > 1 ? ` ${index + 1}` : '';
    return `- \`${environment}${repeat}\` · \`pnpm run restore -- ${options.taskId} ${result.name} ${environment}${repeat}\``;
  }));
  const lines = [
    `# ${options.taskId} ${result.name} UI 평가`, '',
    '아래 명령을 벤치마크 저장소에서 실행한다. 복원된 프로젝트 경로로 이동한 뒤 프로젝트의 설치·실행 명령을 사용한다.', '',
    ...commands, '',
  ];
  if (options.taskId === 'FE-01') {
    lines.push('복원한 프로젝트의 `reference/design/`과 `reference/style-guide.md`에서 원본 시안을 확인한다.', '');
    const template = await fs.readFile(path.join(projectRoot, 'tasks/FE-01/evaluation/user-checklist.md'), 'utf8');
    lines.push(template);
  } else {
    lines.push('각 환경의 화면 구성, 반응형 레이아웃, 상호작용을 확인하고 근거를 기록한다.', '',
      '| 환경·반복 | 확인한 화면·상태 | 평가와 캡처 경로 |', '| --- | --- | --- |', '| | | |', '');
  }
  await fs.writeFile(path.join(result.outputDir, 'user-checklist.md'), lines.join('\n'), { flag: 'wx', mode: 0o600 });
}

export async function snapshotFinalAttempt(options, result, run, instructions) {
  const name = `${environmentDirectory(options, run.environmentId, run.repetition).replaceAll(path.sep, '-')}.zip`;
  const file = path.join('snapshots', name);
  const entry = { environmentId: run.environmentId, repetition: run.repetition, attemptNumber: run.attemptNumber };
  try {
    const sha256 = await archiveWorktree(run.workDir, path.join(result.outputDir, file), instructions);
    return { ...entry, file, sha256 };
  } catch (error) {
    return { ...entry, error: error.message };
  }
}

export async function readResultRuns(file) {
  const resultFile = path.resolve(file);
  const directory = path.dirname(resultFile);
  const result = await readJson(resultFile);
  if (result.schemaVersion !== 1 || !Array.isArray(result.runs)) throw new Error('Invalid result.json');
  const finalRuns = new Map();
  for (const entry of result.runs) finalRuns.set(`${entry.environmentId}/${entry.repetition}`, entry);
  const runs = await Promise.all([...finalRuns.values()].map(async ({ record }) => {
    const recordFile = path.resolve(directory, record);
    if (!recordFile.startsWith(`${directory}${path.sep}`)) throw new Error('Invalid run record path');
    const run = await readJson(recordFile);
    if (run.artifact?.directory) run.artifact.directory = path.join(path.dirname(recordFile), 'artifact');
    return { ...run, recordFile };
  }));
  return { directory, runs };
}

export async function saveResult(result, summary) {
  await writeJsonAtomic(path.join(result.outputDir, 'result.json'), summary);
}
