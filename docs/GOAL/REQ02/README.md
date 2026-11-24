# REQ02 · Runner 자체 브라우저 검증 환경

[요구사항과 제한 검증 기록](../../REQUIREMENTS/REQ02.md)

- [ ] 동일한 Playwright·Chromium 조건에서 두 필수 환경의 실행을 검증한다.
- [ ] 에이전트가 선택한 자체 브라우저 검증 증거와 외부 평가기 판정을 별도로 확인할 수 있다.
- [ ] 실제 Runner 호출에 적용된 브라우저 권한과 확인된 제약을 기록한다.
- [x] Runner 이벤트 키워드 색상과 비색상 환경의 일반 텍스트 출력을 검증한다. `runner/runner.test.mjs`에서 TTY와 `NO_COLOR`를 확인했다.
