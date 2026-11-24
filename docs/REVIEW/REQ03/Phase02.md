# REQ03-Phase02 · 설치 환경과 평가기 캐시 분리 검증

[완료 기준](../../GOAL/REQ03/Phase02.md) · [로드맵](../../../ROADMAP.md)

- [x] 기존 Baseline·codex-workspace·superpowers 설치 환경을 사용자 데이터 경로로 이동했다. 인증 파일 3개의 inode와 권한이 이동 전후에 일치했다.
- [x] Bootstrap 테스트에서 기존 목적지 보존, 이동 후 환경 검증, 인증 내용 미출력을 확인했다. 실제 환경의 `pnpm verify`와 FE-01 dry-run도 통과했다.
- [x] 모의 Codex로 수동 실행 명령 세 개의 환경별 홈과 임시 작업 경로를 확인했다.
- [x] Runner 통합 테스트에서 결과 경로와 평가기 Promptfoo 캐시 경로가 분리되고, 임시 작업 폴더 제거 후 재비교와 복원이 되는지 확인했다.
- [x] Runner 12건, Evaluator 17건, Bootstrap 5건, 과제 2건을 통과했다.
- [ ] 실제 FE-01 에이전트 호출과 AI 평가 검증은 본 벤치마크에서 진행한다.
