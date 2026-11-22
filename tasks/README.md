# 과제 패키지 형식

과제는 `tasks/<과제 ID>/`에 모은다. 원본은 `source/`에 수정 없이 보관한다. `task.md`는 과제 자체의 요구사항, `manifest.json`은 출처와 입력 준비 규칙을 기록한다. 평가 전용 자료는 필요할 때 `evaluation/`에 둔다. Runner는 `--task`로 이 패키지를 읽으며 기존 직접 프롬프트·Fixture 옵션도 유지한다.

```text
tasks/FE-01/
├── source/rest-countries-api-with-color-theme-switcher-master.zip
├── task.md
├── manifest.json
└── evaluation/criteria.md
```

현재 수동 등록 과제는 REST Countries 하나다. 이전 Browser extensions manager·FAQ 제한 검증 과제는 종료했고 역사적 실행 기록은 그대로 보존한다. 과거 REST Countries 실행의 `FE-03` ID는 원본 ZIP 해시가 맞을 때 새 FE-01 평가 기준으로 해석한다.

ZIP 과제 manifest는 과제 ID, 스키마 버전, 원본 ZIP 경로와 SHA-256, ZIP 안의 과제 루트, 프롬프트 경로, 실행 입력으로 복사할 파일 경로를 명시한다. 실행 입력은 **허용 목록**으로 구성한다. ZIP 전체를 작업 디렉터리에 풀지 않는다. 위험한 경로와 중복 ZIP 항목을 거부하고, 지정한 항목만 바이너리 그대로 추출한다. 준비된 입력의 해시를 기록하고 모든 환경·반복에 같은 스냅샷을 제공한다.

`FE-01`의 manifest는 원본 ZIP의 국가 데이터·디자인·스타일 가이드만 허용 목록으로 전달한다. 초기 앱 코드는 공통 frontend 템플릿에서 가져온다. 원본 `AGENTS.md`·`CLAUDE.md`·README·평가 자료는 실행 입력에서 제외한다. 난이도는 확인할 수 없어 `null`이다. 과제 내용은 [task.md](./FE-01/task.md), 판정 항목은 [평가 기준](./FE-01/evaluation/criteria.md)에 있다.

`search --source mentor`는 현재 등록된 FE-01을 보여 준다. 공개 공급원 검색 결과에는 등록 여부를 따로 표시한다.

공개 저장소 공급원은 [`frontendwizards/frontend-challenges`](https://github.com/frontendwizards/frontend-challenges)다. 저장소의 `problems/<id>/README.md`가 요구사항, `starter/` 또는 공통 `starter/solutions/react-ts/`가 초기 코드, `solutions/`가 정답 코드다. 공급원 자체 CLI의 `list`는 실제 목록을 출력하지 않고 `start`는 `npm install`을 실행하므로 등록 CLI는 저장소 디렉터리를 직접 조사한다. 등록 명령은 검색 결과의 여러 ID를 받아 과제별 `source/problem/`과 필요한 공통 starter를 원본 그대로 복사하고 Git 커밋을 manifest에 기록한다. 같은 저장소의 같은 문제는 다시 등록하지 않는다. `solutions/`는 원본 보관 영역에만 남고 Runner 입력에는 들어가지 않는다.

공통 기술 사양은 [frontend/technical-spec.md](./shared/frontend/technical-spec.md)와 같은 영역의 `template/`에서 관리한다. 모든 frontend 과제에 React 19·TypeScript·Vite·Tailwind CSS v4와 pnpm을 적용한다. 과제별 `task.md`에 이 규칙을 반복하지 않는다. 외부 starter의 npm 잠금 파일과 Tailwind v3 설정은 원본에 보존하지만, 실행용 프로젝트는 공통 pnpm 잠금 파일을 사용하고 CSS의 기존 Tailwind 지시문을 v4 형식으로 준비한다. 공통 `pnpm-workspace.yaml`은 pnpm 12 설치에 필요한 `esbuild` 빌드만 허용한다. 컴포넌트 구조, 상태 관리, 스타일 파일 구성은 구현자가 선택한다.

```sh
pnpm run tasks -- search --name star --difficulty easy
pnpm run tasks -- register --ids star-rating,traffic-light
pnpm run runner -- --task tasks/FE-01 --environments baseline,codex-workspace --dry-run
```

`register`에 `--ids`를 생략하면 검색 결과 번호를 복수 선택할 수 있다. 등록·실행 준비는 원본 저장소의 `npm install`을 호출하지 않는다.

`evaluation/`은 평가기에만 제공한다. Runner는 이를 작업 디렉터리에 복사하거나 프롬프트에 포함하지 않는다. FE-01의 기능 8개·접근성 1개·기술 2개는 `evaluators/countries.mjs`가 검사한다. [기능 점검표](../evaluators/functional-review.md)는 자동 검사가 놓치는 조작과 예외 상태를 확인하는 데 사용한다. 시각적 품질은 사용자가 별도로 판단한다.
