import { stripVTControlCharacters } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const functionalChecks = [
  ['FE01-F01', '250개국 목록 표시'],
  ['FE01-F02', '국가명 검색'],
  ['FE01-F03', '지역 필터'],
  ['FE01-F04', '국가 상세 및 목록 복귀'],
  ['FE01-F05', '국경 국가 상세 이동'],
  ['FE01-F06', '검색과 지역 필터 조합'],
  ['FE01-F07', '빈 검색 결과와 목록 복구'],
  ['FE01-F08', '수도·국경 정보가 없는 국가 처리'],
];
const accessibility = ['FE01-A01', '검색·상세·지역 필터 키보드 조작'];
const dimensionLabels = {
  structure: '구조', readability: '가독성', maintainability: '유지보수성',
  complexity: '복잡성 관리', responsibility: '책임 분리',
};
const observationLabels = {
  expectedCount: '기대 개수', observedCount: '표시 개수', missing: '누락', duplicateNames: '중복',
  query: '검색어', observed: '검색 결과', asiaCount: '아시아 결과 수', europeCount: '유럽 결과 수',
  name: '상세 국가명', returned: '목록 복귀', detailPass: '상세 정보 일치', source: '출발 국가',
  borderCode: '국경 코드', destination: '도착 국가', noneCount: '아시아 검색 결과 수',
  germanyOnly: '유럽 검색 결과', emptyCount: '일치하지 않는 검색의 결과 수', restoredCount: '복구된 목록 수',
  countries: '확인 국가', searchWorked: '키보드 검색', detailWorked: '키보드 상세 이동',
  backWorked: '키보드로 목록 복귀', borderWorked: '키보드 국경 이동', regionWorked: '키보드 지역 필터',
  selectedRegion: '선택된 지역', pnpmLock: 'pnpm 잠금 파일', npmLock: 'npm 잠금 파일', yarnLock: 'Yarn 잠금 파일',
};
const statusLabels = { pass: '☑ 통과', fail: '☐ 실패', error: '오류', not_evaluated: '미평가' };
const number = (value) => Number.isFinite(value) ? value.toLocaleString('en-US') : '—';

function inline(value) {
  return stripVTControlCharacters(String(value ?? '')).replace(/\s+/g, ' ').trim()
    .replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))
    .replace(/[\\`*_[\]~|]/g, '\\$&');
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ];
}

function outcome(status) {
  return statusLabels[status] ?? statusLabels.not_evaluated;
}

function findCheck(entry, id) {
  return entry.objective?.checks?.find((check) => check.id === id);
}

function compactReason(reason) {
  const lines = stripVTControlCharacters(reason).trim().split(/\r?\n/);
  const selector = lines.find((line) => line.includes('waiting for '))?.split('waiting for ')[1];
  if (selector && /timeout/i.test(lines[0])) {
    const targets = [
      [/main h1.*Japan/, 'Japan 상세 화면 제목'],
      [/main h1/, '상세 화면 제목'],
      [/getByRole\('link'.*France/, 'France 국경 링크'],
      [/filter by region\|all regions\|selected/i, '지역 필터를 여는 버튼'],
      [/locator\('main'\)/, '상세 화면 본문'],
    ];
    const target = targets.find(([pattern]) => pattern.test(selector))?.[1];
    return target ? `브라우저 검사에서 대기 시간 초과 · 확인 대상 ${target}`
      : `브라우저 검사에서 대기 시간 내 대상을 확인하지 못함 (${inline(selector)})`;
  }
  return inline(lines[0]?.slice(0, 300));
}

function checkDetail(check) {
  const evidence = check?.evidence;
  if (!evidence) return '';
  if (evidence.reason) return compactReason(evidence.reason);
  const observations = Object.entries(observationLabels).flatMap(([key, label]) => {
    const value = evidence[key];
    if (value === undefined) return [];
    if (typeof value === 'boolean') return [`${label} ${value ? '예' : '아니오'}`];
    const text = Array.isArray(value) ? value.slice(0, 5).join(', ') || '없음' : value ?? '없음';
    return [`${label} ${inline(text)}`];
  });
  if (evidence.install) {
    observations.push(`설치 종료 코드 ${number(evidence.install.exitCode)}`);
    if (evidence.build) observations.push(`빌드 종료 코드 ${number(evidence.build.exitCode)}`);
  }
  return observations.join(' · ');
}

function resultMatrix(items, columns) {
  return table(['검사 항목', ...columns.map(({ title }) => title)], items.map(([id, label]) => [
    label, ...columns.map(({ entry }) => outcome(findCheck(entry, id)?.status)),
  ]));
}

function reviewChecks(items, columns) {
  const notes = [];
  for (const { entry, title } of columns) {
    const passed = items.filter(([id]) => findCheck(entry, id)?.status === 'pass').length;
    notes.push(`- **${title}** · ${passed}/${items.length} 통과`);
    for (const [id, name] of items) {
      const check = findCheck(entry, id);
      if (check?.status === 'pass') continue;
      const evidence = checkDetail(check);
      notes.push(`  - ${name} (${id}) · ${outcome(check?.status)}${evidence ? ` · ${evidence}` : ''}`);
    }
  }
  return [...notes, ''];
}

function staticStatus(result) {
  return outcome(result?.status ?? (typeof result?.pass === 'boolean' ? (result.pass ? 'pass' : 'fail') : null));
}

function staticReview(columns) {
  const tools = [['typescript', 'TypeScript'], ['eslint', 'ESLint']];
  const rows = [
    ['공통 기술 스택', ...columns.map(({ entry }) => outcome(findCheck(entry, 'FE01-T01')?.status))],
    ['의존성 설치 및 빌드', ...columns.map(({ entry }) => outcome(findCheck(entry, 'FE01-T02')?.status))],
    ...tools.map(([key, name]) => [name, ...columns.map(({ entry }) => staticStatus(entry.static?.[key]))]),
  ];
  const notes = columns.flatMap(({ entry, title }) => {
    const eslint = entry.static?.eslint;
    const summary = Number.isFinite(eslint?.errorCount)
      ? `ESLint 오류 ${eslint.errorCount}건, 경고 ${number(eslint.warningCount)}건` : '';
    const build = ['FE01-T01', 'FE01-T02'].map((id) => findCheck(entry, id))
      .filter((check) => check && check.status !== 'pass').map((check) => checkDetail(check)).filter(Boolean);
    const typeCommand = entry.static?.typescript?.command;
    const typeIssue = entry.static?.typescript?.status === 'fail' || entry.static?.typescript?.status === 'error'
      ? typeCommand?.output?.split(/\r?\n/).find((line) => /error TS\d+/.test(line)) ?? typeCommand?.error : null;
    const lintIssue = eslint?.diagnostics?.find((diagnostic) => diagnostic.severity === 2);
    const messages = [...build, typeIssue && inline(typeIssue), summary,
      lintIssue && inline(`${lintIssue.file}:${lintIssue.line} ${lintIssue.message}`)].filter(Boolean);
    return messages.length ? [`- **${title}** · ${messages.join(' · ')}`] : [];
  });
  return [...table(['검사 항목', ...columns.map(({ title }) => title)], rows), ...notes, ...(notes.length ? [''] : [])];
}

function aiReview({ entry, title }) {
  const ai = entry.aiCode;
  const heading = [`### ${title}`, ''];
  if (ai?.status !== 'evaluated') {
    const status = outcome(ai?.status);
    const reason = ai?.reason ? compactReason(ai.reason) : '';
    return [...heading, `- **AI 채점** · ${status}${reason ? ` · ${reason}` : ''}`, ''];
  }
  const dimensions = Object.entries(ai.dimensions ?? {})
    .map(([key, detail]) => ({
      name: dimensionLabels[key] ?? inline(key), ...detail, ratio: detail.points / detail.maximum,
    }));
  if (!dimensions.length) return [...heading, `- **AI 코드 품질** · ${number(ai.score)}/100 · 영역별 근거 미기록`, ''];
  const strongest = Math.max(...dimensions.map((dimension) => dimension.ratio));
  const weakest = Math.min(...dimensions.map((dimension) => dimension.ratio));
  const areasAt = (ratio) => dimensions.filter((dimension) => dimension.ratio === ratio)
    .map(({ name, points, maximum }) => `${name} ${points}/${maximum}`).join(', ');
  const evidenceExample = dimensions.map(({ name, evidence }) => ({
    name, parts: String(evidence ?? '').split(/\s*[,;]\s*(?:but|though|although|however)\b[, ]*\s*/i),
  })).find(({ parts }) => parts.length === 2 && parts.every(Boolean));
  const positiveExample = evidenceExample ? ` · ${evidenceExample.name} 근거 예시 ${inline(evidenceExample.parts[0])}` : '';
  const issueExample = evidenceExample ? ` · ${evidenceExample.name} 근거 예시 ${inline(evidenceExample.parts[1])}` : '';
  const structure = ai.dimensions?.structure?.evidence;
  return [
    ...heading,
    `- **특징** · AI 코드 품질 ${number(ai.score)}/100. ${structure ? inline(structure) : ''}`.trimEnd(),
    `- **긍정적인 점** · 배점 대비 가장 높은 평가 ${areasAt(strongest)}${positiveExample}`,
    `- **문제점** · ${weakest === 1 ? '감점 없음' : `배점 대비 감점이 큰 영역 ${areasAt(weakest)}${issueExample}`}`,
    '',
    ...table(['평가 영역', '점수', '파일·줄', 'AI 채점 근거'], dimensions.map((dimension) => [
      dimension.name, `${dimension.points}/${dimension.maximum}`,
      inline(`${dimension.file}:${dimension.line}`), inline(dimension.evidence),
    ])),
  ];
}

function time(durationMs) {
  if (!Number.isFinite(durationMs)) return '—';
  const seconds = Math.round(durationMs / 1000);
  return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function columnTitle(entry, entries) {
  const group = entries.filter((item) => item.environmentId === entry.environmentId);
  if (group.length === 1) return inline(entry.environmentId);
  const repetition = entry.repetition ?? 1;
  const attempt = entry.attemptNumber ?? 1;
  return `${inline(entry.environmentId)} · 반복 ${repetition} · 시도 ${attempt}`;
}

export async function writeQualityReport(record, outputDir) {
  const columns = record.entries.map((entry) => ({ entry, title: columnTitle(entry, record.entries) }));
  const { weights, threshold } = record.entries[0].quality;
  const model = record.evaluator?.judge?.model;
  const lines = [
    `# ${inline(record.entries[0].taskId)} 외부 품질 평가`, '',
    '[평가 원본 JSON](./evaluation.json)', '',
    '## 01. 필수 기능', '',
    ...resultMatrix(functionalChecks, columns),
    '### 리뷰', '',
    ...reviewChecks(functionalChecks, columns),
    '## 02. 접근성', '',
    ...resultMatrix([accessibility], columns),
    ...reviewChecks([accessibility], columns),
    '## 03. 빌드, TypeScript, ESLint', '',
    ...staticReview(columns),
    '## 04. 코드 품질 리뷰', '',
    ...(model ? [`평가 모델 ${inline(model)}`, ''] : []),
    ...columns.flatMap(aiReview),
    '## 05. 자동 품질 총점', '',
    `기능 ${weights.functionality}점, 접근성 ${weights.accessibility}점, 정적 분석 ${weights.static}점, AI 코드 품질 ${weights.aiCode}점입니다.`,
    `필수 기능 100%, 기술 스택·빌드·타입·린트 통과, 종합 ${threshold}점 이상이 합격 기준입니다. 시각 평가는 별도로 기록합니다.`,
    '',
    ...table(['비교군', '점수', '필수 기준', '판정'], columns.map(({ entry, title }) => {
      const { quality } = entry;
      return [title, quality.complete ? `${number(quality.score)}/100` : '미산정',
        quality.mandatoryPassed ? '충족' : '미충족', quality.complete ? (quality.passed ? '합격' : '미달') : '평가 미완료'];
    })),
    '## 06. 구현 시간 및 토큰', '',
    ...table(['비교군', '구현 시간', '비캐시 입력', '캐시 입력', '출력', '구현 토큰 합계', 'AI 채점 토큰'],
      columns.map(({ title, entry }) => {
        const { inputTokens, cachedInputTokens, outputTokens } = entry.implementationUsage ?? {};
        const uncached = Number.isFinite(inputTokens) && Number.isFinite(cachedInputTokens) && cachedInputTokens <= inputTokens
          ? inputTokens - cachedInputTokens : null;
        const total = Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? inputTokens + outputTokens : null;
        return [title, time(entry.durationMs), number(uncached), number(cachedInputTokens),
          number(outputTokens), number(total), number(entry.evaluatorUsage?.total)];
      })),
  ];
  const output = path.join(outputDir, 'evaluation.md');
  await fs.writeFile(output, lines.join('\n'), { mode: 0o600 });
  return output;
}
