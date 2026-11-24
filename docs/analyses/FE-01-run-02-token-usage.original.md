그리고 토큰 소모가 많이 차이났어 어느 부분에서 codex-workspace의 토큰이 많이 소모됐는지 체크해줘

FE-01 run-02에서 codex-workspace는 baseline보다 510,768토큰을 더 사용했고, 그 차이의 97.6%는 캐시 입력이었습니다. 실행 로그에서 가장 눈에 띄는 차이는 구현 전에 더 많은 스킬 문서를 읽었고, 구현 후에도 국기 이미지와 UI를 수정·재검증하면서 그동안 쌓인 문맥을 더 여러 번 사용했다는 점입니다.

| 구현 토큰   | baseline | codex-workspace |     차이 |
| ----------- | -------: | --------------: | -------: |
| 캐시 입력   |  401,536 |         900,224 | +498,688 |
| 비캐시 입력 |   37,985 |          48,141 |  +10,156 |
| 출력        |    6,669 |           8,593 |   +1,924 |
| 합계        |  446,190 |         956,958 | +510,768 |

캐시를 포함하면 2.14배, 비캐시 입력과 출력만 합치면 44,654 → 56,734토큰으로 1.27배입니다. 모두 구현 시도의 수치이며 외부 AI 품질평가는 별도입니다. baseline 사용량 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/baseline/attempt-01/events.jsonl`) · codex-workspace 사용량 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl`)

어디서 차이가 벌어졌나

1. 구현 전 스킬 문서 탐색. baseline은 Sites/SKILL.md를 읽은 명령에서 13,739자를 반환했습니다. codex-workspace는 skill-router → 스킬 맵과 3개 스킬 → 참조 인덱스 → 세부 문서 순서로 읽었습니다. 이 5개 명령의 출력은 59,615자였고 일부 프로젝트 조회·설치 출력도 포함합니다. 특히 레이아웃·타이포그래피·아이콘·Tailwind·코드 스타일 등을 함께 읽은 한 명령의 출력만 25,034자였습니다. 앞서 살펴본 workspace-unit-doc-manager나 라우팅 architecture.md를 읽는 데 이만큼 쓴 것은 아닙니다. baseline 스킬 조회 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/baseline/attempt-01/events.jsonl:5`) · codex-workspace 세부 문서 조회 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl:18`)
   ⚠ Heads up, you have less than 25% of your 5h limit left. Run /status for a breakdown.
   FE-01 run-02에서 codex-workspace는 baseline보다 510,768토큰을 더 사용했고, 그 차이의 97.6%는 캐시 입력이었습니다. 실행 로그에서 가장 눈에 띄는 차이는 구현 전에 더 많은 스킬 문서를 읽었고, 구현 후에도 국기 이미지와 UI를 수정·재검증하면서 그동안 쌓인 문맥을 더 여러 번 사용했다는 점입니다.

| 구현 토큰   | baseline | codex-workspace |     차이 |
| ----------- | -------: | --------------: | -------: |
| 캐시 입력   |  401,536 |         900,224 | +498,688 |
| 비캐시 입력 |   37,985 |          48,141 |  +10,156 |
| 출력        |    6,669 |           8,593 |   +1,924 |
| 합계        |  446,190 |         956,958 | +510,768 |

캐시를 포함하면 2.14배, 비캐시 입력과 출력만 합치면 44,654 → 56,734토큰으로 1.27배입니다. 모두 구현 시도의 수치이며 외부 AI 품질평가는 별도입니다. baseline 사용량 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/baseline/attempt-01/events.jsonl`) · codex-workspace 사용량 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl`)

어디서 차이가 벌어졌나

1. 구현 전 스킬 문서 탐색. baseline은 Sites/SKILL.md를 읽은 명령에서 13,739자를 반환했습니다. codex-workspace는 skill-router → 스킬 맵과 3개 스킬 → 참조 인덱스 → 세부 문서 순서로 읽었습니다. 이 5개 명령의 출력은 59,615자였고 일부 프로젝트 조회·설치 출력도 포함합니다. 특히 레이아웃·타이포그래피·아이콘·Tailwind·코드 스타일 등을 함께 읽은 한 명령의 출력만 25,034자였습니다. 앞서 살펴본 workspace-unit-doc-manager나 라우팅 architecture.md를 읽는 데 이만큼 쓴 것은 아닙니다. baseline 스킬 조회 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/baseline/attempt-01/events.jsonl:5`) · codex-workspace 세부 문서 조회 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl:18`)
2. 구현 후 국기 이미지와 레이아웃 재검증. 두 환경 모두 브라우저 검증을 시도했습니다. codex-workspace는 원격 국기 로딩 문제를 확인한 뒤 SVG 250개를 로컬에 저장하고, 브라우저에서 250개 모두 디코딩되는지 검사했습니다. 이후 생성된 CSS를 확인하고 상세 화면의 간격을 수정한 뒤 다시 빌드했습니다. 전체 완료 셸 명령은 baseline 12개, codex-workspace 19개였습니다. SVG는 파일로 저장됐고 다운로드 명령의 출력은 186자였습니다. 이 구간에서 토큰 차이를 설명하는 쪽은 이미지 크기보다 추가 수정과 검증을 위해 기존 문맥을 이어 사용한 횟수입니다. 국기 다운로드 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl:37`) · 브라우저 재검증 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl:41`) · 마지막 수정·빌드 (`~/.local/state/skill-benchmark/results/FE-01/run-02/attempts/codex-workspace/attempt-01/events.jsonl:45`)

확정할 수 있는 것은 추가 토큰의 거의 전부가 캐시 입력이었다는 점입니다. 저장 로그는 구현 턴 전체의 토큰만 제공하므로, 498,688개 중 정확히 몇 개가 스킬 탐색이나 브라우저 검증에서 발생했는지는 분리할 수 없습니다. 이번 실행에서 가장 근거 있는 해석은 초반의 넓은 참조 문서 탐색이 문맥을 키웠고, 후반의 추가 작업이 그 문맥을 반복해서 입력에 포함시켰다는 것입니다.
Worked for 54s • 1:31 AM

이는 어떻게 해결해야할까

FE-01 결과를 보면 가장 먼저 바꿀 곳은 codex-workspace의 참조 문서 선택 규칙입니다. 이번 실행은 구현 전에 스킬 관련 명령 5개에서 약 6만 자를 읽었는데도, 정작 기대했던 문서 계획과 라우팅 구조를 검토한 흔적은 없었습니다. 토큰을 줄이면서 스킬 준수도도 높일 여지가 있는 부분입니다.

| 우선순위 | 바꿀 곳                                  | 구체적인 변경                                                                                                                                                                                                               |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | skill-router와 개별 스킬                 | 첫 구현 전에 내려야 하는 결정을 기준으로 참조 문서를 선택합니다. FE-01이라면 문서 계획과 목록·상세 경로 설계를 먼저 확인합니다. 레이아웃·타이포그래피·아이콘·Tailwind 문서는 구현 중 해당 결정에 필요한 것만 읽도록 합니다. |
| 2        | react-ui-style, code-style의 참조 인덱스 | 이번처럼 SKILL.md → 분야별 README → 하위 README → 세부 문서를 연속해서 읽는 경로를 줄입니다. SKILL.md에서 자주 쓰는 세부 문서와 읽는 조건을 바로 안내하면, 에이전트가 여러 인덱스를 열지 않고도 선택할 수 있습니다.         |
| 3        | 구현 후 검증                             | 브라우저 검증은 유지합니다. 실제로 국기 로딩 문제를 발견했습니다. 다만 관련 수정을 마친 뒤 한 번의 빌드와 브라우저 실행에서 이미지·키보드 탐색·상세 이동·복귀 상태를 함께 검사하고, 실패한 항목만 다시 확인하도록 합니다.   |

측정할 때는 캐시 포함 합계와 비캐시 입력·출력을 함께 봐야 합니다. 이번에는 각각 2.14배와 1.27배였습니다. 특히 셸 명령 수에 일괄 상한을 두면, 긴 문서 여럿을 cat 한 번으로 읽는 행동은 그대로 두면서 실제 결함을 찾는 브라우저 검증만 줄일 수 있습니다.

제가 권하는 적용 순서는 최신 버전으로 같은 FE-01을 먼저 한 번 실행하고, 그 로그를 기준으로 참조 규칙을 수정하는 것입니다. 기존 run-02는 구버전이고 최신본에는 이미 문서 관리 스킬의 선택 조건이 보강됐습니다. 이후 같은 입력·모델로 비교할 때는 ① 첫 코드 수정 전에 어떤 문서를 읽었는지, ② 기대한 구조가 산출물에 나타났는지, ③ 필수 기능 통과 수와 비캐시 입력·출력이 어떻게 변했는지를 함께 보면 됩니다. 이렇게 해야 토큰 절감이 필요한 작업까지 생략한 결과인지 구분할 수 있습니다.
