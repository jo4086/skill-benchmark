import { promises as fs } from 'node:fs';
import path from 'node:path';

const missing = '—';
const number = (value) => Number.isFinite(value) ? value.toLocaleString('en-US') : missing;
const cell = (value) => String(value ?? missing).replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');

function usageParts(usage) {
  const input = usage?.inputTokens;
  const cached = usage?.cachedInputTokens;
  const output = usage?.outputTokens;
  const uncached = Number.isSafeInteger(input) && Number.isSafeInteger(cached) && cached <= input
    ? input - cached : null;
  return { input, cached, uncached, output,
    total: Number.isSafeInteger(input) && Number.isSafeInteger(output) ? input + output : null };
}

function reportLink(directory, file, label) {
  return file ? `[${label}](${path.relative(directory, file).split(path.sep).map(encodeURIComponent).join('/')})` : null;
}

export function renderComparisonSummary(comparison, outputDir = '.', sources = new Map()) {
  const rows = comparison.runs.map((run) => {
    const usage = usageParts(run.usage);
    const source = sources.get(run.runId);
    const links = [reportLink(outputDir, source?.record, '기록'), reportLink(outputDir, source?.artifact, '결과물')].filter(Boolean);
    return `| ${cell(run.environmentId)} | ${cell(run.repetition)} | ${cell(run.status)} | ${number(run.durationMs)} | ${number(usage.uncached)} | ${number(usage.cached)} | ${number(usage.input)} | ${number(usage.output)} | ${number(usage.total)} | ${links.join(' · ') || missing} |`;
  });
  const checks = comparison.quality?.comparableCheckIds ?? [];
  return [
    `# ${cell(comparison.taskId)} 비교 결과`,
    '',
    `비교 ID: \`${comparison.id}\`  `,
    `환경: ${comparison.runs.map((run) => `${cell(run.environmentId)} ${run.repetition}회차`).join(', ')}  `,
    `모델 기록: ${comparison.model ?? '미지정'} · 추론 수준: ${comparison.reasoningEffort ?? '미지정'}`,
    '',
    '| 환경 | 반복 | 실행 | 시간 (ms) | 비캐시 입력 | 캐시 입력 | 입력 전체 | 출력 | 총토큰 | 실행 자료 |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
    '입력 전체에는 캐시 입력이 포함된다. 비캐시 입력은 입력 전체에서 캐시 입력을 뺀 값이다. 총토큰은 입력 전체와 출력의 합계다. 측정값이 없으면 `—`로 표시한다.',
    '',
    `Promptfoo 판정: 성공 ${number(comparison.promptfooStats?.successes)}, 실패 ${number(comparison.promptfooStats?.failures)}, 오류 ${number(comparison.promptfooStats?.errors)}.`,
    `객관 검사: ${checks.length ? checks.join(', ') : '미평가'}. 전체 품질: ${comparison.quality?.status === 'not_evaluated' ? '미평가' : '일부 평가'}.`,
    'Promptfoo의 실행 성공 판정은 기능·시각·코드 품질 합격을 뜻하지 않는다.',
    '',
    '[원본 비교 데이터](./comparison.json) · [Promptfoo 결과](./promptfoo.json)',
    '',
  ].join('\n');
}

export async function writeComparisonReports(comparison, outputDir, resultsRoot, sources) {
  await fs.writeFile(path.join(outputDir, 'summary.md'), renderComparisonSummary(comparison, outputDir, sources));
  if (!resultsRoot) return;
  const entries = [];
  for (const directory of await fs.readdir(resultsRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const file = path.join(resultsRoot, directory.name, 'comparison.json');
    let saved;
    try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!saved?.id || !saved?.taskId || !Array.isArray(saved.runs)) continue;
    const summaryFile = path.join(resultsRoot, directory.name, 'summary.md');
    const hasSummary = await fs.stat(summaryFile).then(() => true, (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    const time = saved.id.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)?.[0] ?? missing;
    const environments = [...new Set(saved.runs.map((run) => run.environmentId))].join(' vs ');
    entries.push({ time, taskId: saved.taskId, environments, directory: directory.name,
      file: hasSummary ? 'summary.md' : 'comparison.json', quality: saved.quality?.status ?? 'unknown' });
  }
  entries.sort((a, b) => b.time.localeCompare(a.time));
  const lines = [
    '# 비교 결과 목록', '',
    '시간은 UTC이며, 최신 비교가 위에 있다. 기존 결과의 요약표가 없으면 원본 비교 데이터로 연결한다.', '',
    '| 시간 (UTC) | 과제 | 환경 | 품질 평가 | 결과 |',
    '| --- | --- | --- | --- | --- |',
    ...entries.map((entry) => `| ${cell(entry.time)} | ${cell(entry.taskId)} | ${cell(entry.environments)} | ${cell(entry.quality)} | [열기](./${encodeURIComponent(entry.directory)}/${entry.file}) |`),
    '',
  ];
  await fs.writeFile(path.join(resultsRoot, 'INDEX.md'), lines.join('\n'));
}
