# REQ02 — Runner 자체 브라우저 검증 환경

[완료 기준](../../GOAL/REQ02.md)

현재 수동 과제는 REST Countries FE-01이다. 이 문서의 FE-03 표기는 당시 저장된 동일 과제 실행의 역사적 ID이며 원본 기록을 변경하지 않는다.

## 요구사항

- Baseline과 codex-workspace에 같은 Playwright 버전, Chromium 실행 파일, Sandbox·승인·네트워크 설정을 제공한다. 기본 모델은 `gpt-6.2-sol`이다.
- 에이전트가 개발 서버를 열고 데스크톱·모바일 화면을 확인할 수 있게 한다. 브라우저 검증 여부는 에이전트가 결정하며 공통 과제 프롬프트에는 검증 절차를 강제하지 않는다.
- 실행별 스크린샷과 검증 로그는 실행별 기록에 보존한다. 자체 검증 사용 여부·관측된 실행 결과와 외부 Evaluator 결과를 구분한다.
- 기존 FE-03 결과와 수동 피드백 기록은 변경하지 않는다. 본 벤치마크 재실행은 별도 승인 후 수행한다.

## 최소 재현 결과

2026-11-21에 과제와 분리된 `/tmp/skill-benchmark-browser-*` 및 `/tmp/skill-benchmark-playwright-api-*`에서 두 격리 환경을 검사했다.

| 조건 | Baseline | codex-workspace |
| --- | --- | --- |
| 기본 `workspace-write`, `approval_policy=never` | 로컬 바인딩 `EPERM`, Chromium 종료 133 | 동일 |
| 같은 Sandbox에서 `sandbox_workspace_write.network_access=true` | 로컬 바인딩·Chromium 성공 | 동일 |
| Playwright 1.65.1 API, 로컬 HTTP 접속·모바일 스크린샷 | `PLAYWRIGHT_OK`, PNG 생성 | `PLAYWRIGHT_OK`, PNG 생성 |

Playwright API 재현의 첫 호출은 격리 HOME에 브라우저 캐시가 없어 양쪽 모두 실패했다. 공유 브라우저 캐시 경로를 명시한 재호출에서 양쪽 모두 성공했다. 별도 실험에서 Codex의 실험적 네트워크 프록시로 허용 도메인을 localhost로 제한하면 서버 바인딩은 성공했지만 Chromium 소켓 생성이 `EPERM`으로 실패했다. 따라서 현재 구현은 `workspace-write` 파일 Sandbox를 유지하면서 해당 Codex 호출의 네트워크 접근을 허용한다. **이 옵션은 외부 네트워크까지 열어 두므로 localhost 전용 네트워크 격리라고 주장하지 않는다.** 브라우저·서버는 실행별 작업 디렉터리에서 시작하고 Runner 종료 시 Codex 프로세스 그룹 정리를 시도한다. 파일 경로 분리만으로 환경 사이의 전체 파일 접근을 차단하지도 않는다.

## 구현과 현재 검증 상태

- 공통 frontend 템플릿에 Playwright 1.65.1과 잠금 파일을 추가했다. Runner는 브라우저 실행 파일 존재와 해시를 확인하고 모델·브라우저·네트워크 조건을 `run.json`에 기록한다.
- Runner는 `screenshots/playwright/`, `playwright-report/`, `test-results/`, `self-validation.log`를 실행별 `self-validation/`에 복사한다. 이 자료는 Evaluator의 코드 스냅샷에서 제외한다. 관측된 명령과 파일로 사용 여부 및 자체 검증 결과를 기록하며, 증거가 없으면 `not_observed`로 둔다. 이 상태는 에이전트가 실제로 사용하지 않았다는 증명이 아니다.
- 기존 FE-03 `runs/`, `results/`와 수동 피드백 파일은 수정하지 않았다. 전체 Runner 경로와 자동 비교의 새 브라우저 기록은 실제 과제 재실행 없이 아직 확인하지 않았다.
- 타임아웃 뒤 프로세스 그룹 강제 종료에 실패해도 Runner가 예외로 중단되지 않고 오류를 `run.json`에 기록하도록 수정했다.

## 남은 확인

- [x] Runner 단위 테스트 11건, Bootstrap 5건, 과제 4건, Evaluator 17건, `pnpm verify`, FE-02 두 환경 dry-run을 실행했다. 실제 과제 에이전트 호출은 없었다.
- [ ] 본 벤치마크 승인 시 같은 과제에서 두 환경의 새 `run.json`·스크린샷·프로세스 정리를 확인한다.
- [ ] 필요하다면 localhost로 제한한 네트워크와 브라우저 실행을 동시에 만족하는 별도 격리 방식을 조사한다.
