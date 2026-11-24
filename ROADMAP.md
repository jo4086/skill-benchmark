# 로드맵

프로젝트 전체 완료 기준은 [GOAL](./GOAL.md), 현재 책임과 데이터 흐름은 [ARCHITECTURE](./ARCHITECTURE.md), 품질 판정은 [REQ01 계약](./docs/SPEC/REQ01/quality-evaluation.md)을 따른다. 과거 실행의 ID와 원시 기록은 변경하지 않는다.

## 완료한 기반

- [x] Bootstrap에서 Baseline·codex-workspace 환경 준비와 고정 출처 검증을 구현했다. 공개 Skill 모음은 선택 설치한다.
- [x] Runner의 독립 실행, 시도별 시간·토큰, 동일 세션의 최대 두 번 피드백 수정 기록을 구현했다. 실제 Codex resume 연결은 아직 검증하지 않았다.
- [x] Promptfoo 비교와 저장된 결과의 객관·정적·AI 코드 품질 재평가를 분리했다. AI 평가기는 격리 홈과 읽기 전용 결과물 복사본을 사용한다.
- [x] REST Countries 원본 ZIP을 현재 `tasks/FE-01`로 등록했다. 이전 FE-03 실행은 원본 해시가 일치할 때 새 FE-01 평가 기준을 적용한다. 이전 Browser extensions manager·FAQ 테스트 과제는 종료했다.
- [x] FE-01의 외부 기능 8개·접근성 1개·기술 2개 평가기와 [기능 점검표](./evaluators/functional-review.md)를 작성했다. 실제 저장 결과의 판정은 [FE-01 검증 기록](./docs/REVIEW/REQ01/FE01/automatic-evaluation.md)에 남긴다.
- [x] REQ03-Phase01 · [실행과 결과 보관](./docs/REQUIREMENTS/REQ03.md)을 구현했다. 저장 경로, 동시 할당, 재비교와 ZIP 복원을 [검증](./docs/REVIEW/REQ03/Phase01.md)했다.
- [x] REQ03-Phase02 · [설치 환경과 평가기 캐시 분리](./docs/GOAL/REQ03/Phase02.md)를 구현했다. 기존 환경 이동과 새 경로를 [검증](./docs/REVIEW/REQ03/Phase02.md)했다.
- [x] [REQ01 평가 보고서](./docs/GOAL/REQ01/README.md)를 평가 JSON과 함께 생성한다. 모의 평가와 저장된 FE-01 run-02로 검증했다.
- [x] REQ03 설치 환경 개선 · [실행 전 codex-workspace 버전 선택](./docs/GOAL/REQ03/Phase02.md)을 구현하고 승인한 커밋이 재설치와 검증에 유지되는지 확인했다.
- [x] REQ02 Runner 로그 표시 개선 · [ANSI 이벤트 색상](./docs/GOAL/REQ02/README.md)을 구현하고 TTY·`NO_COLOR` 출력을 검증했다.
- [x] REQ01 Runner 기본 평가 · FE-01 실행 후 별도 활성화 옵션 없이 전체 품질 평가와 보고서를 생성하도록 하고 Runner 테스트와 dry-run으로 검증했다.
- [x] REQ03-Phase03 · [실행 환경 출처 보존](./docs/GOAL/REQ03/Phase03.md)을 구현했다. 커밋·설치/제외 Skill·콘텐츠 해시를 시도 기록과 ZIP에 보존하는지 [검증](./docs/REVIEW/REQ03/Phase03.md)했다.

- [x] 디렉터리 정리 · 기능별 하위 역할과 참조 경로를 정돈하고 빈 자리표시자·중복 ZIP·예전 로컬 `results/`를 삭제했다. 기존 테스트와 경로 검증 결과는 [완료 기준](./GOAL.md#디렉터리-정리-완료-기준)에 기록했다.

## 남은 검증

- [x] FE-01 저장 결과의 자동 검사 밖 기능 보완 항목을 두 환경에서 점검하고 [검증 기록](./docs/REVIEW/REQ01/FE01/automatic-evaluation.md)에 남겼다.
- [ ] [FE-01 사용자 평가 항목](./docs/REVIEW/REQ01/FE01/user-evaluation.md)에 시각 평가를 기록한다.
- [ ] 새 FE-01 과제를 명시 모델·동일 입력·반복 조건으로 두 필수 환경에서 실행하고, Promptfoo 비교와 목표 품질 도달 비용을 검증한다. 과거 FE-03 실행의 `model:null`은 모델 동일성 증거가 아니다.
- [ ] 실제 Codex 세션의 피드백 resume 연결과 공개 Skill 환경의 실행·Skill 활용 증거를 검증한다.
- [ ] 반복 재현성, 지침·Hook 격리와 결과 공유 시 민감 정보 제외를 검증한다.

이전 FAQ 제한 검증의 실행·평가 사실은 [Phase01](./docs/REVIEW/REQ01/Phase01.md)과 [Phase02](./docs/REVIEW/REQ01/Phase02.md), 과거 FE-03 실행 과정은 [FE03 기록](./docs/REVIEW/REQ01/FE03.md)에 역사적 자료로 보존한다. 이는 현재 FE-01의 평가 결과를 대신하지 않는다.
