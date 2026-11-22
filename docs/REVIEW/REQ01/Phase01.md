# REQ01-Phase01 검증 기록

단계 상태는 [ROADMAP](../../../ROADMAP.md)의 `REQ01-Phase01`이 소유한다. 수용 기준은 [REQ01](../../REQUIREMENTS/REQ01.md)에 있다.

## FE-02 제한 실행

2026-11-21 KST에 사용자가 제공한 `faq-accordion-main.zip`을 당시 FE-02 테스트 과제로 보존·등록한 뒤 Baseline 환경에서 1개 독립 시도를 실행했다. `--feedback-repairs 1 --diagnostic-target-score 50 --max-total-tokens 70000 --reasoning low --timeout-seconds 300`을 사용했다. 실제 호출은 1회였다.

| 항목 | 관측값 |
| --- | --- |
| Runner 상태 | `completed` |
| 진단 상태 | `diagnostic_target_reached` (전체 품질 합격 아님) |
| 객관 점수 | 100/100, FE02-T01·T02·F01·F02·A01 모두 통과 |
| 입력 SHA-256 | `57b38ad3d3f8c99d769dbe8da87cf3a2909c8a9dd52d5cd1011615c6ec1b3065` |
| 입력 토큰 | 285,621 (그중 캐시 입력 259,584) |
| 출력 토큰 | 2,745 |
| 입력+출력 토큰 | 288,366 |
| 피드백 수정 | 0회. 첫 시도가 진단 기준을 충족해 Codex resume는 실행되지 않음 |

로컬 증거는 Git에서 제외된 `runs/2026-11-20T20-37-20-385Z-98ca170b-1ea5-4fac-a7d0-2dbf45194572/run.json`과 `runs/trials/2026-11-20T20-37-20-382Z-934a598c-a26e-4531-8f07-c251499f351a/trial.json`에 있다. 원시 JSONL은 민감할 수 있으므로 이 문서에 복사하지 않는다.

## 확인한 것과 남은 것

- [x] FE-02 ZIP을 원본 그대로 보존하고 실행 입력에서 원본 AI 지침과 평가 자료를 제외했다. `pnpm run test:tasks` 3건 통과.
- [x] FAQ 평가기가 정상·고장 가상 화면을 구분했다. `pnpm run test:evaluators` 10건 통과.
- [x] FE-02 실제 최초 Codex 실행, 평가, 진단 점수와 시도별 사용량 기록을 확인했다.
- [ ] 실제 `codex exec resume` 수정 경로는 첫 시도가 100점이어서 확인하지 못했다. Runner 가상 테스트 10건은 통과했다.
- [ ] 전체 완성도 합격은 시각·코드 품질을 평가하지 않아 판단하지 못했다.
- [x] 당시의 토큰 예산은 첫 호출 전에 강제되지 않았다. 설정한 70,000토큰을 첫 호출이 288,366토큰으로 초과했다. 사용자 요청에 따라 이후 `--max-total-tokens`와 토큰 기반 중단을 제거했다. 현재는 시도별 사용량만 기록한다. [변경 기록](../../FEEDBACK/REQ01/remove-token-stop.md).
