# Runner

피드백 수정의 범위와 수용 기준은 [REQ01](../docs/REQUIREMENTS/REQ01.md)에 있다.
브라우저 자체 검증 환경과 최소 재현 결과는 [REQ02](../docs/REQUIREMENTS/REQ02.md)에 있다.

Runner는 Bootstrap이 설치한 환경에서 같은 프롬프트와 초기 파일을 비대화형 Codex로 실행한다. 과제 정의와 평가는 Runner에 포함하지 않는다. 실행 전에 Bootstrap 검증을 통과해야 하며, 실제 실행에는 환경별 `.codex/auth.json`과 시스템 명령 `zip`, `unzip`, `flock`이 필요하다.

```sh
pnpm run runner -- \
  --task tasks/FE-01 \
  --environments baseline,codex-workspace \
  --dry-run
```

`--dry-run`을 빼면 실제 Codex 세션이 시작되어 토큰을 사용한다. `--repeats N`, `--model MODEL`, `--reasoning LEVEL`, `--timeout-seconds N`을 지정할 수 있다. 한 번의 호출은 최대 세 실행으로 제한한다. 기존 `--task-id ID --prompt-file FILE --fixture-dir DIR` 형식도 유지한다.

기본 모델은 `gpt-6.2-sol`이다. 두 환경 모두 `workspace-write`와 승인 없음 설정을 유지하고, 로컬 서버·Chromium에 필요한 네트워크 접근을 실행별 Codex 옵션으로 허용한다. 이 옵션은 외부 네트워크에도 적용된다. 공통 frontend 입력에는 Playwright 1.65.1이 포함되며 Runner가 같은 공유 Chromium 캐시를 지정한다. 자체 브라우저 검증 여부는 에이전트가 결정한다. `run.json.browser`에는 브라우저 버전·경로·실행 파일 해시, `selfValidation`에는 관측된 브라우저 명령·스크린샷·자체 검증 상태를 기록한다. 각 시도의 `self-validation/`에 스크린샷과 로그를 따로 보존하고 Evaluator의 `artifact/` 입력에서는 제외한다. 실행 종료 시 Runner는 실행 프로세스 그룹 정리를 시도한다.

각 실행의 입력 파일을 준비한 직후, Codex 호출 전에 과제 ID·환경·반복·시도 번호와 작업 디렉터리 및 실시간 이벤트 로그 경로를 `START` 줄로 출력한다. 결과 코드를 직접 확인하거나 `pnpm dev`로 실행할 때는 이 작업 디렉터리를 사용한다. 실행 시작 시 `result.json`의 절대 경로도 출력한다.

`--evaluate-quality`를 붙이면 모든 시도 뒤 저장된 결과를 재평가하고 시도당 AI 코드 품질 채점을 한 번 호출한다. 피드백 최대 2회와 독립 시도 3개를 함께 지정하면 AI 채점도 최대 9회다. `--judge-home DIR`로 별도 평가기 인증 홈을 지정할 수 있다. 이 옵션이 없으면 평가기를 자동 호출하지 않으며, 나중에 저장된 `run.json`으로 따로 재평가할 수 있다.

FE-01에서는 `--feedback-repairs 2`로 최초 시도 뒤 최대 두 번의 피드백 수정을 요청할 수 있다. `--repeats`는 서로 독립된 최초 입력을 만들고, 피드백 수정은 각 독립 시도의 **같은 Codex 세션과 작업 디렉터리**를 이어받는다. 한 호출은 최대 세 독립 시도이며, 수정 옵션을 2로 두면 최대 아홉 번의 Codex 호출이 발생한다. 토큰은 매 시도 기록하지만 사용량으로 실행을 중단하지 않는다. 실행 전 최대 호출 수를 확인한다.

비용을 줄이는 제한 검증에서는 `--feedback-repairs 1 --diagnostic-target-score 50`처럼 수정 기회를 적게 두고 낮은 **객관 진단 중단 점수**를 사용한다. 50점이 기본값이다. 도달하면 `diagnostic_target_reached`로 멈추며, 이는 전체 품질 합격을 뜻하지 않는다. `trial.json`의 `targetKind`, `targetScore`, `firstTargetAttempt`로 적용 기준을 확인한다. 실제 벤치마크의 필수 기능 100%·종합 90점 목표는 [REQ01](../docs/REQUIREMENTS/REQ01.md)에 별도로 남아 있다.

`trials/<환경>/trial.json`은 최초·첫 수정·둘째 수정마다 객관 점수, 이전 시도 대비 점수 변화, 입력·출력·캐시 입력 토큰의 **해당 시도 값과 누적값**, 실행 시간의 해당 시도 값과 누적값, 전달한 피드백, 중단 사유를 저장한다. 첫 시도 점수와 첫 진단 기준 도달 시도 번호를 별도 필드에 남긴다. 토큰 측정이 없으면 `null`과 사유를 기록하고 수정 횟수 규칙을 계속 적용한다. 평가용 설치·빌드는 작업 디렉터리 복사본에서 실행한다. 자동 품질 총점은 별도 `evaluate` 결과에 기록하고 현재 피드백 중단에는 사용하지 않는다.

현재 FE-01 자동 피드백은 F01–F08, A01, T01–T02의 실패 증거를 사용한다. 객관 항목 통과율은 `objective_diagnostic`이며 자동 품질 총점이 아니다. 저장된 결과 재평가에는 코드 품질 기준과 90점 합격 판정이 적용된다. 실제 Codex 세션의 resume 경로는 아직 검증하지 않았다.

한 호출에서 두 번 이상 실행하면 Promptfoo 비교를 자동으로 수행한다. 실패한 실행도 포함한다. `comparisons/final/summary.md`에서 시간·입력·캐시·출력 토큰과 객관 검사 결과를 확인한다. 피드백 모드에서는 `comparisons/first/`에 최초 시도를 비교하고, 후속 시도가 있으면 `comparisons/final/`에 최종 시도를 비교한다. 각 비교의 원본은 같은 폴더의 `comparison.json`과 `promptfoo.json`에 있다.

FE-01 비교 시 Evaluators는 평가용 복사본에서 `pnpm install --frozen-lockfile`과 `pnpm build`를 실행하고 로컬 Chromium으로 기능 8개·접근성 1개를 검사한다. 기술 항목은 2개다. Chromium 기본 경로는 `/snap/bin/chromium`이며 다른 경로는 `PLAYWRIGHT_CHROMIUM_PATH`로 지정한다. 과거 FE-03 실행은 원본 ZIP 해시가 일치할 때만 이 기준을 적용한다. 이전 FAQ 과제의 실행 기록은 [Phase01](../docs/REVIEW/REQ01/Phase01.md)·[Phase02](../docs/REVIEW/REQ01/Phase02.md)에 역사적 자료로 보존한다.

Runner는 [과제 패키지](../tasks/README.md)의 허용된 원본 파일과 공통 기술 사양을 먼저 준비한다. ZIP 원본, 정답 코드, 평가 자료, 원본 AI 행동 지침은 작업 디렉터리에 넣지 않는다. 준비한 Fixture를 임시 스냅샷으로 한 번 복사하고 각 실행은 이 스냅샷을 저장소 밖의 새 작업 디렉터리에 복사한다. 저장소 루트와 상위 경로의 `AGENTS.md`가 작업 경로의 상위 지침으로 로드되지 않는지 검사한다. 실행은 반복 번호를 먼저, 환경 선택 순서를 다음 기준으로 순차 수행한다. 환경마다 `HOME`, `CODEX_HOME`, `XDG_CONFIG_HOME`을 설정한다. 이 설정은 파일 시스템 전체에 대한 접근 제한을 의미하지 않는다.

## 작업 폴더와 저장된 결과

한 번의 Runner 호출은 과제별 번호를 하나 할당한다. `--dry-run`에서는 번호를 할당하지 않는다. 번호는 `state.json`의 `runs`에 과제별로 저장하며, 완료 여부는 각 실행의 `result.json`에서 확인한다.

```text
/tmp/skill-benchmark/FE-01-run-01/
├── baseline/
└── codex-workspace/

~/.local/state/skill-benchmark/
├── state.json
└── results/FE-01/run-01/
    ├── result.json
    ├── user-checklist.md
    ├── attempts/<환경>/attempt-01/
    ├── trials/<환경>/trial.json
    ├── comparisons/final/summary.md
    ├── quality/evaluation.json
    └── snapshots/
        ├── baseline.zip
        └── codex-workspace.zip
```

`TMPDIR`과 절대 경로인 `XDG_STATE_HOME`으로 임시·영구 저장 위치를 각각 지정할 수 있다. 독립 반복이 여러 개면 작업 폴더와 기록의 환경 아래에 `repeat-01/`을 추가하고 ZIP 이름에도 반복 번호를 넣는다. `result.json`은 작업 경로, 환경별 시도·토큰, 기록과 평가 및 ZIP의 상대 경로를 모아 보여 준다. `trials/`는 피드백 실행에서, `quality/evaluation.json`은 `--evaluate-quality`에서 생성한다. `user-checklist.md`에는 수동 UI 평가를 기록한다.

각 시도에는 `run.json`, 원시 이벤트 `events.jsonl`, `stderr.txt`, 평가용 소스 복사본 `artifact/`가 저장된다. 최종 ZIP에는 프로젝트 소스, 의존성 명세·잠금 파일, 테스트와 문서를 넣고 환경의 Codex 지침은 `environment/AGENTS.md`에 별도로 보존한다. 인증·캐시·설치 의존성은 제외한다.

```sh
pnpm run restore -- FE-01 run-01 baseline
```

출력된 프로젝트 경로에서 `pnpm install --frozen-lockfile`과 `pnpm dev`를 실행한다. 독립 반복을 지정하려면 환경 이름 뒤에 번호를 붙인다. 복원마다 새 임시 폴더를 만들고 ZIP의 SHA-256을 확인한다.

## 제한 실행 확인

2026-11-21 KST에 짧은 직접 입력 과제 `smoke-01`을 Baseline과 codex-workspace에서 각 1회 실행했다. 두 실행은 입력 SHA-256이 같고 요청한 `answer.txt`를 생성했으며 `completed` 상태로 끝났다. `turn.completed`에서 다음 수치를 읽었고 Promptfoo 비교도 성공 2건으로 기록됐다. 입력 토큰에는 캐시 입력이 포함된다.

| 환경 | 실행 시간 | 입력 토큰 | 그중 캐시 입력 | 출력 토큰 |
| --- | ---: | ---: | ---: | ---: |
| baseline | 13,951 ms | 49,103 | 45,952 | 159 |
| codex-workspace | 13,998 ms | 62,882 | 48,000 | 226 |

로컬 증거는 `runs/2026-11-20T16-14-53-306Z-b5a3877a-c076-47b0-a3ff-c5077b0d2db8/`, `runs/2026-11-20T16-15-07-261Z-6ff0f7d7-9b41-447b-9621-a24340747902/`, `results/2026-11-20T16-15-21-260Z-484f5106-c196-414a-b38d-cca909ef3fa2/`에 있으며 Git에서 제외된다. 이때 `--reasoning low`를 지정했고 `--model`은 지정하지 않아 `run.json`의 모델 값은 `null`이다. 이 결과는 실행 경로 확인이며 모델 동일성, FE-01 품질, Skill 실제 사용, 반복 재현성을 입증하지 않는다.
## 저장된 결과 품질 재평가

실행 번호 아래의 `result.json`을 사용하면 환경·반복별 최종 시도를 불러온다.

```sh
result="$HOME/.local/state/skill-benchmark/results/FE-01/run-01/result.json"
pnpm run compare -- --result "$result"
pnpm run evaluate -- --result "$result" --skip-ai
```

재비교와 재평가는 같은 실행 아래의 `comparisons/rechecks/`와 `quality/rechecks/`에 새 기록으로 쌓인다. 이전 결과나 개별 시도를 선택하려면 두 명령의 `--runs <run.json> ...`를 사용한다. 이렇게 여러 실행에서 선택한 기록의 보고서는 과제 아래의 `comparisons/` 또는 `quality/`에 저장한다.

`evaluate`는 구현 Codex 재호출 없이 저장된 코드에 객관 검사와 Promptfoo `agent-rubric`을 적용한다. AI 평가에는 비용이 발생한다. `--skip-ai`를 붙이면 객관 검사만 수행한다. 파일 인증이 필요하면 별도 평가 전용 홈에 `auth.json`을 두고 `--judge-home /absolute/path`로 지정한다. 각 평가기는 인증을 새 임시 홈에 복사하고 사용 후 삭제한다. [점수와 판정 기준](../docs/SPEC/REQ01/quality-evaluation.md)
