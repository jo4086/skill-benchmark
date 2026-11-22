# skill-benchmark

`skill-benchmark`는 직접 개발한 [`codex-workspace`](https://github.com/jo4086/codex-workspace)의 Skill 시스템이 실제 AI 코딩 작업에 얼마나 효과적인지 검증하기 위한 프로젝트입니다. 사용자 제작 Skill이 없는 기준 환경 및 공개 Skill 모음과 **동일한 과제와 실행 조건**에서 비교합니다. 특정 시스템의 우수성을 전제하지 않고, 측정 결과로 장단점과 개선할 부분을 찾는 것이 목적입니다.

비교할 항목은 요구사항 충족률과 코드 품질, Skill 라우팅 정확도와 실제 활용 여부, 실행 시간과 토큰 사용량, 사용량 대비 결과물의 완성도입니다. 자동 측정값과 주관적 평가는 구분합니다.

설계 문서: [요구사항 목록](./docs/REQUIREMENTS/README.md)은 신규 기능의 REQ 번호와 수용 기준을 연결합니다. [아키텍처](./ARCHITECTURE.md)는 책임과 데이터 흐름, [GOAL](./GOAL.md)과 [요구사항별 GOAL](./GOAL/README.md)은 완료 기준, [ROADMAP](./ROADMAP.md)은 구현 단계와 진행 상태를 설명합니다. [Bootstrap 안내](./bootstrap/README.md)에는 설치 명령과 기록 형식, [Runner 안내](./runner/README.md)에는 현재 구현된 실행 명령, [평가 기준](./evaluators/criteria.md)에는 현재 판정 범위가 있습니다.

외부 과제의 원본과 실행 입력을 분리하는 [과제 패키지 형식](./tasks/README.md)이 구현되어 있습니다. 현재 수동 과제 `FE-01`은 사용자가 제공한 REST Countries ZIP을 원본 그대로 보관합니다. 과거 FE-03 실행은 원본 해시를 검증해 새 FE-01 기준으로 재평가합니다. 공개 GitHub 과제는 [`frontendwizards/frontend-challenges`](https://github.com/frontendwizards/frontend-challenges)에서 검색·등록할 수 있습니다.

## 비교군

| 구분 | 환경 | 설치 원칙 |
| --- | --- | --- |
| 필수 | **Baseline** | 사용자 정의 Skill 없이 비교 기준을 구성합니다. Codex 기본 제공 Skill과 모든 환경에 공통으로 제공할 플러그인 Skill은 유지하고, 사용자 제작 `AGENTS.md`·Hook·Skill은 추가하지 않습니다. |
| 필수 | **codex-workspace** | `codex-workspace`의 특정 Git 커밋을 기본 설치 원본으로 사용합니다. 로컬 개발 버전도 복사할 수 있습니다. `templates/global-AGENTS.md`를 환경의 `.agents/AGENTS.md`로 설치하고 `.codex/AGENTS.md`에 연결하며 Skill·Hook도 구성합니다. 실제 사용자 전역 설정은 수정하지 않습니다. |
| 선택 | **공개 Skill 모음별 환경** | Bootstrap에서 복수 선택할 수 있습니다. 선택한 모음마다 독립된 환경을 만들며 서로 다른 모음을 합치지 않습니다. 저장소 URL과 설치된 커밋을 기록합니다. |

공개 Skill의 초기 **추천 후보**는 다음과 같습니다. 저장소별 Skill 경로는 확인해 설정에 반영했지만, 실제 Codex 세션에서의 호환성과 공식 플러그인 전체 기능은 아직 검증하지 않았습니다.

| 저장소 | 비교 관점 |
| --- | --- |
| [`obra/superpowers`](https://github.com/obra/superpowers) | 설계·계획·테스트·디버깅 등 개발 워크플로 |
| [`anthropics/skills`](https://github.com/anthropics/skills) | 범용 Skill과 Skill 생성 |
| [`mattpocock/skills`](https://github.com/mattpocock/skills) | TypeScript 중심 개발 작업 |

## 목표 구성과 역할

아래 구조에는 Bootstrap·Runner·Promptfoo 비교기와 저장된 결과의 품질 재평가 명령이 있습니다. 시각 품질은 [FE-01 사용자 평가 항목](./docs/REVIEW/REQ01/FE01/user-evaluation.md)에 직접 기록합니다.

```text
skill-benchmark/
├── bootstrap/
│   ├── setup.mjs           # 초기 설정 및 공개 Skill 선택
│   ├── verify.mjs          # 설치 환경 검증
│   ├── sources.json        # Skill 모음 메타데이터와 고정 커밋
│   ├── common.mjs          # 설치·검증 공통 로직
│   ├── auth.mjs            # 선택적 로그인 파일 복사
│   ├── bootstrap.test.mjs  # 임시 저장소 기반 통합 테스트
│   └── README.md           # Bootstrap 사용법
├── runner/
│   ├── index.mjs           # 실행 진입점과 Codex 실행
│   ├── trial.mjs           # 피드백 수정과 시도별 측정 기록
│   ├── usage.mjs           # JSONL 토큰 지표 수집
│   ├── runner.test.mjs     # 단위 테스트
│   └── README.md           # Runner 사용법
├── environments/
│   ├── baseline/           # 필수 기준 환경
│   ├── codex-workspace/    # 필수 검증 환경
│   └── <선택한 공개 Skill 환경>/ # 선택 모음마다 별도 생성
├── tasks/                  # FE-01 REST Countries ZIP, 과제 manifest·공통 기술 사양·검색 CLI
├── fixtures/               # 기존 빈 디렉터리
├── evaluators/             # Promptfoo 비교, 기능·접근성·정적·AI 품질 재평가
├── docs/REQUIREMENTS/      # 번호별 신규 기능 요구사항
├── scripts/
│   └── test-isolation.sh   # 현재 수동 실행 스크립트
├── GOAL/                   # REQ별 완료 기준
├── promptfooconfig.yaml   # 동적 비교 설정 안내
├── package.json
├── .gitignore
├── AGENTS.md
└── README.md
```

### Bootstrap: 환경 준비

Bootstrap은 실행 도구를 확인하고 **Baseline과 codex-workspace를 항상 구성**합니다. 공개 Skill 후보를 보여 주고 복수 선택을 받아, 선택한 저장소의 고정 커밋에서 Skill을 모음별 환경에 복사합니다. codex-workspace에는 `templates/global-AGENTS.md`와 Hook도 복사합니다. 환경별 `HOME`, `CODEX_HOME`, `XDG_CONFIG_HOME` 경로와 설치 원본·커밋·내용 해시를 기록하고 검증합니다. 고정 Git 커밋 설치와 `pnpm verify`는 확인했으며, Codex 세션에서의 Skill·Hook 실제 동작은 아직 검증하지 않았습니다.

재실행할 때 동일한 환경은 보존합니다. 변경된 기존 환경이 있으면 대화형 실행에서 보관 여부를 묻고, 비대화형 실행은 중단합니다. 동의하거나 `--archive-existing`을 명시하면 기존 환경을 백업 위치로 옮긴 뒤 새로 설치합니다. 대화형 실행에서 사용자가 선택하거나 `--copy-auth`를 명시하면 현재 Codex의 파일 기반 인증을 각 환경에 복사할 수 있습니다. 사용자 원본과 공개 Skill 원본은 수정하지 않습니다. Bootstrap은 Runner 소스코드를 동적으로 생성하지 않습니다.

### Runner: 과제 실행

새 실행의 기본 모델은 `gpt-6.2-sol`이며, 두 환경에 같은 Playwright·Chromium 접근 조건을 제공한다. 에이전트의 자체 브라우저 검증은 선택 사항이다. 사용 증거와 스크린샷은 외부 평가와 분리해 저장한다. 최소 재현과 네트워크 접근 범위는 [REQ02](./docs/REQUIREMENTS/REQ02.md)를 참조한다.

`runner/`는 Bootstrap이 준비한 환경을 사용합니다. `--task`로 과제 패키지를 선택하거나 기존 과제 ID·프롬프트·Fixture 옵션을 사용할 수 있습니다. 동일하게 준비한 초기 파일을 저장소 밖의 실행별 독립 작업 디렉터리에 배치해 Codex CLI를 비대화형으로 실행합니다. FE-01 피드백 모드는 같은 세션에서 최대 두 번 수정하며 시도별 점수·토큰 증분과 누적값을 기록합니다. 토큰 사용량은 실행 중단 조건으로 쓰지 않습니다. 작업 폴더는 `/tmp/skill-benchmark/<과제>-run-NN/`에, 실행 기록과 평가·복원용 ZIP은 `~/.local/state/skill-benchmark/results/<과제>/run-NN/`에 둡니다. 과거 제한 검증에서 두 필수 환경의 짧은 직접 입력 과제와 당시 FE-02 FAQ 과제를 실제 실행했습니다. FAQ의 피드백 수정 경로는 실행되지 않았습니다. Runner는 Skill 설치나 평가 점수 산정을 담당하지 않습니다. 명령과 기록 형식은 [Runner 안내](./runner/README.md)를 참조하세요.

관리용 프로젝트 루트 [`AGENTS.md`](./AGENTS.md)가 평가 대상 Codex에 로드되면 비교가 오염될 수 있습니다. 소규모 실행의 두 작업 디렉터리에는 해당 파일이 없었지만 Codex가 실제로 읽은 지침 전체는 확인하지 않았습니다. 환경 변수 분리만으로 완전한 파일 시스템 격리가 보장되지는 않습니다.

### Evaluators: 결과 평가

`evaluators/`의 `compare`는 저장된 실행의 성공과 기능·접근성·기술 검사를 Promptfoo로 비교하고 토큰 원값을 보존합니다. 별도 `evaluate`는 저장된 FE-01 REST Countries 산출물에 TypeScript·ESLint·빌드·Playwright와 Promptfoo `agent-rubric` 코드 품질 검사를 적용합니다. 기능 40·접근성 15·정적 분석 20·AI 코드 품질 25점이며 필수 기능과 빌드·타입·린트가 통과하고 총점이 90점 이상이어야 자동 품질 합격입니다. AI 평가는 비교군의 Skill·지침을 제외한 별도 복사본에서 읽기 전용으로 진행하며, 평가기 토큰은 구현 토큰과 분리합니다. 시각 유사도는 별도 미평가입니다. [평가 기준](./evaluators/criteria.md)과 [REQ01 품질 계약](./docs/SPEC/REQ01/quality-evaluation.md)을 참조하세요.

## 사용 흐름

1. 저장소를 복제합니다.
2. Node.js 22.22 이상에서 `pnpm install --frozen-lockfile`로 Promptfoo·Playwright·ESLint·Codex SDK 평가 의존성을 설치합니다. 브라우저 검사에는 로컬 Chromium이 필요합니다. Runner의 보관·복원에는 `zip`, `unzip`, `flock`을 사용합니다.
3. Bootstrap을 실행해 필수 환경을 구성합니다.
4. 비교할 공개 Skill 모음을 복수 선택합니다.
5. 환경 설치 결과와 고정된 커밋을 검증합니다.
6. Runner로 동일한 과제를 선택한 환경에서 반복 실행합니다.
7. Runner가 출력한 `result.json` 경로에서 실행 기록과 ZIP, `user-checklist.md`, 자동 평가 보고서를 찾습니다. 표는 비캐시 입력·캐시 입력·출력 토큰을 분리합니다.

Bootstrap 명령은 `pnpm run setup`과 `pnpm verify`입니다. 이미 설치한 환경의 로그인 파일만 복사하려면 `pnpm run auth:copy`를 사용합니다. `pnpm setup`은 pnpm 자체 명령과 충돌합니다. 공개 모음 선택, 고정 커밋 설치, 검증, 기존 환경 보존 방법은 [Bootstrap 안내](./bootstrap/README.md)를 참조하세요. 과제 검색·등록은 `pnpm run tasks -- search|register`, Runner는 `pnpm run runner -- --task tasks/FE-01 ...`로 실행합니다. 저장된 실행은 `compare`와 `evaluate`에 `--result <result.json>`을 넘겨 다시 평가할 수 있습니다. `pnpm run restore -- FE-01 run-01 baseline`은 그 실행의 Baseline ZIP을 새 작업 폴더에 풀고 경로를 출력합니다. 자세한 옵션은 [과제 안내](./tasks/README.md)와 [Runner 안내](./runner/README.md)에 있습니다.

## 현재 구현 상태와 Git 관리

현재 `package.json`에는 Bootstrap·과제·Runner·Promptfoo 비교·저장 결과 품질 재평가 명령과 관련 테스트, 수동 실행 명령이 등록되어 있습니다. `test:public`은 설치된 공개 환경이 하나면 이를 사용하고, 여러 개면 선택을 요청합니다. `pnpm run test:public <환경 ID>`로 직접 지정할 수도 있습니다. 수동 실행 명령들은 [`scripts/test-isolation.sh`](./scripts/test-isolation.sh)를 통해 설치 기록이 있는 환경의 `HOME`, `CODEX_HOME`, `XDG_CONFIG_HOME`을 설정하고 **대화형** Codex를 `--no-daemon`으로 시작합니다. 작업 경로는 실행마다 저장소 밖 `/tmp/skill-benchmark/manual-<환경>-*/`에 새로 만들고 경로와 Codex 홈을 출력합니다. 이 수동 스크립트는 Skill 설치·환경 디렉터리 생성·검증·과제 실행·결과 수집을 수행하지 않습니다. 정식 Runner의 제한 실행 결과와 남은 검증 항목은 [로드맵](./ROADMAP.md)에 기록했습니다.

현재 Bootstrap 인덱스에는 `baseline`, `codex-workspace`, `superpowers`가 기록되어 있습니다. 환경 구성은 이후 선택과 재설치에 따라 달라질 수 있습니다. `tasks/`의 현재 수동 과제는 REST Countries FE-01입니다. 이전 Browser extensions manager·FAQ 테스트 과제는 종료했고, 과거 실행·리뷰 기록은 원본 증거로 보존합니다. 두 필수 환경의 과거 FE-03 실행은 원본 ZIP 해시가 일치하면 새 FE-01 평가기로 다시 검사할 수 있습니다. 이 실행의 `run.json` 모델 값은 `null`이므로 모델 동일성의 증거로 사용할 수 없습니다. 시각 평가는 사용자가 별도로 수행합니다. `fixtures/`에는 구현 파일이 없고 `scripts/benchmark-runner.mjs`는 빈 파일입니다.

`environments/`와 이전 실행의 `runs/`·`results/`는 Git에서 제외됩니다. 인증 정보와 환경변수 파일도 제외하며, 설치 환경 안의 로컬 상태를 Git으로 공유하지 않습니다. 실행 결과를 공유하려면 민감 정보가 없는 별도 산출물 형식을 정해야 합니다.
