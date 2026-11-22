# Skill Benchmark — Promptfoo와 외부 Evaluator 설계안

> 상태: 설계 초안 · 2026-11-21\
> 과거 설계 제안: `skill-benchmark` / 당시 FE-03 REST Countries. 현재 구현·판정은 [FE-01 평가 기준](../tasks/FE-01/evaluation/criteria.md)과 [REQ01 품질 계약](./SPEC/REQ01/quality-evaluation.md)을 따른다. 이 문서의 예시 점수와 가중치는 현재 평가 결과가 아니다.\
> 목적: Baseline과 codex-workspace의 **결과물 품질**을 동일 조건으로 평가하고, 구현 비용과 분리해 비교한다.

## 1. 핵심 개념

**Promptfoo는 평가 프레임워크이며, Evaluator는 개별 품질 항목을 검사하는 채점 로직이다.** 둘은 대체 관계가 아니다.

- **Runner**: 동일 과제를 각 에이전트 환경에서 실행하고 코드·로그·토큰 사용량을 보존한다.
- **외부 Evaluator**: 보존된 산출물에 대해 기능, 시각, 접근성, 코드 품질을 독립적으로 검사한다.
- **Promptfoo**: Evaluator 결과를 사용자 정의 assertion 등으로 받아 점수, 실패 이유, 실험 간 비교를 관리한다. 필요하면 LLM 기반 채점도 수행할 수 있다.
- **구현 에이전트의 자체 검증**: 개발 과정의 활동 기록일 뿐, 외부 Evaluator의 합격 판정으로 대체하지 않는다.

현재 Promptfoo가 `execution_completed`만 확인한다면, 이는 **프로세스 완료 여부**를 측정할 뿐 결과물 품질을 측정하지 않는다.

## 2. 권장 평가 영역

| 영역 | 권장 수단 | 예시 검사항목 | FE-03 초기 가중치(제안) |
|---|---|---|---:|
| 기능 | 외부 Playwright 테스트 | 검색, 지역 필터, 상세, 뒤로 가기, 테마 지속성, 잘못된 경로 | 40% |
| 시각 | 고정 뷰포트 스크린샷 + 시각 평가 | 레이아웃, 국기 비율, 간격, 타이포그래피, 반응형 | 25% |
| 접근성 | axe-core + 키보드 테스트 | 자동 탐지 위반, 포커스, 키보드 조작 | 15% |
| 코드 품질 | TypeScript·ESLint·빌드 + 블라인드 AI 리뷰 | 타입 안정성, 책임 분리, 중복, 유지보수성 | 20% |

가중치는 **예시**이며 첫 공식 평가 전에 고정한다. 시각 평가에서 픽셀 차이는 참고 자료이지 곧바로 품질 점수가 아니다. axe-core만으로 모든 접근성 문제가 검출되지는 않는다. 코드 길이 또는 파일 수만으로 품질을 판단하지 않는다.

## 3. 실행 흐름

```text
Runner
  ├─ Baseline 최초 산출물 ───────┐
  └─ codex-workspace 최초 산출물 ─┤
                                ▼
                     독립 외부 Evaluator
                       ├─ Playwright 기능
                       ├─ 스크린샷·시각 평가
                       ├─ axe-core·키보드
                       └─ 정적 검사·AI 리뷰
                                ▼
                    표준화된 평가 결과 JSON
                                ▼
                  Promptfoo assertion / 집계
                                ▼
               품질 점수 + 증거 + 실패 사유
                                │
                   Runner 사용량과 별도 비교
```

Promptfoo의 JavaScript assertion은 `pass`, `score`, `reason`, `namedScores`, `componentResults` 등을 포함하는 결과를 반환할 수 있다. 기존 Evaluator JSON을 읽어 이 형태로 변환하는 어댑터를 둘 수 있다. 연결 방법은 현재 프로젝트의 Promptfoo 설정을 확인한 뒤 결정한다.

## 4. 제안 디렉터리

**프로젝트 기준 위치(예시):** `~/projects/skill-benchmark/`

```text
evaluators/
  functional/        # 외부 Playwright 테스트
  visual/            # 스크린샷 캡처 및 시각 평가
  accessibility/     # axe-core 및 키보드 테스트
  code-quality/      # 정적 검사 및 AI 코드 리뷰
  rubric.json        # 고정 평가 기준 및 가중치
  index.ts           # Evaluator 실행·결과 취합
  promptfoo-adapter/ # 평가 결과를 assertion에 연결
results/
  <run-id>/
    evaluation.json
    evidence/
```

폴더명은 설계 예시이며 실제 저장소 구조를 확인한 뒤 조정한다.

## 5. 평가 결과 스키마 초안

```json
{
  "taskId": "FE-03",
  "runId": "example-run-id",
  "artifactId": "anonymous-artifact-a",
  "evaluatorVersion": "0.1.0",
  "status": "evaluated",
  "scores": {
    "functional": 0.9,
    "visual": 0.8,
    "accessibility": 0.85,
    "codeQuality": 0.75
  },
  "weightedScore": 0.84,
  "checks": [
    {
      "id": "search-by-name",
      "category": "functional",
      "status": "pass",
      "score": 1,
      "reason": "Search results match fixed fixture",
      "evidence": ["evidence/search-test.json"]
    }
  ],
  "evaluatorUsage": {
    "inputTokens": null,
    "outputTokens": null,
    "costUsd": null
  }
}
```

위 JSON은 **스키마 형태를 설명하는 예시 데이터**이며 실제 FE-03 평가 결과가 아니다. `weightedScore` 역시 예시 값이다. 실행 실패나 평가 불가능 상태는 `0점`과 구별해 `not_evaluated` / `infrastructure_error` 등으로 기록한다.

## 6. 공정성 및 재현성 원칙

1. **블라인드 평가**: AI 평가자에게 Baseline / Workspace 라벨, Skill 이름, 사용 토큰을 숨긴다.
2. **동일 조건**: 동일한 테스트 데이터, 브라우저 버전, 뷰포트, 폰트, 네트워크 조건, 평가 모델과 루브릭을 사용한다.
3. **고정 Fixture**: 가능하면 외부 API 응답을 고정해 서비스 상태 변화가 점수에 영향을 주지 않게 한다.
4. **독립 검증**: 구현 에이전트가 만든 테스트와 PASS 로그를 외부 평가의 근거로 그대로 신뢰하지 않는다.
5. **증거 보존**: 각 감점·실패 항목에 테스트 로그, 스크린샷, 파일 위치 등 근거를 연결한다.
6. **비용 분리**: Runner 구현 토큰, 피드백 수정 토큰, 외부 Evaluator 토큰·비용을 따로 기록한다.
7. **실험 불변성**: 최초 결과는 덮어쓰지 않고 수동 수정 결과는 별도 실험으로 분류한다.
8. **AI 평가 변동성**: 동일 루브릭이라도 판정이 달라질 수 있으므로 모델 버전·설정과 반복 평가 결과를 기록한다.

## 7. FE-03에 적용하는 순서

**1단계 — 기능 Evaluator**\
기존 최초 산출물을 대상으로 검색, 필터, 상세, 뒤로 가기, 테마, 잘못된 경로 등을 외부 Playwright 테스트로 평가한다. 테스트가 실패했을 때 구현 오류와 서버·브라우저 환경 오류를 구분한다.

**2단계 — 접근성 및 빌드**\
axe-core, 키보드 조작, TypeScript·빌드·ESLint 검사 결과를 추가한다. 프로젝트에 해당 검사 설정이 없다면 설치·설정 차이를 명시한다.

**3단계 — 시각 평가**\
고정된 데스크톱·모바일 뷰포트, 라이트·다크, 목록·상세 화면을 캡처한다. 공식 시안이 있는 경우 비교하고 AI 평가에는 동일한 화면과 구체적인 루브릭을 제공한다.

**4단계 — 코드 품질 AI 평가**\
동일한 코드 범위와 평가 기준으로 블라인드 리뷰한다. 파일 분리 여부 자체보다 실제 결합도, 중복, 복잡성, 변경 용이성을 판단한다.

**5단계 — Promptfoo 통합**\
각 Evaluator의 표준 결과를 Promptfoo 사용자 정의 assertion과 named metric에 연결하고, 최종 품질·실행 시간·토큰을 별도 축으로 비교한다.

## 8. FE-03 기존 기록에 대한 주의

- Baseline과 codex-workspace **첫 시도**는 원본 그대로 보존한다.
- codex-workspace의 **수동 피드백 1회**는 별도 스냅샷이며 Baseline에는 같은 수정 기회가 없었다.
- 구현 에이전트의 Playwright PASS는 자체 검증 기록이다. 외부 품질 점수는 아직 없다.
- 첫 Runner 실행은 모델 ID가 기록되지 않았고 수동 수정은 다른 실행 조건을 사용했다. 이 둘을 동일 조건의 자동 비교로 간주하지 않는다.
- 기존 스냅샷을 재평가할 수 있는지는 빌드 재현성, API 의존성, 서버 실행 가능 여부를 먼저 확인한다.

## 9. 구현 전에 결정할 사항

- FE-03 기능 테스트의 구체적인 합격 조건과 Fixture
- 평가 대상 화면·뷰포트·브라우저 버전
- AI 시각·코드 평가의 루브릭, 평가 모델, 반복 횟수
- 가중치와 합격 기준, 인프라 오류 처리 방식
- Promptfoo 연동 방식: 개별 assertion 실행 또는 외부 평가 결과 JSON 연결

## 10. 참고 문서

- Promptfoo assertions / metrics: https://www.promptfoo.dev/docs/configuration/expected-outputs/
- Promptfoo JavaScript assertions: https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/
- Playwright web server: https://playwright.dev/docs/test-webserver
- Playwright screenshots: https://playwright.dev/docs/screenshots
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing

---

**결론:** Promptfoo를 교체하거나 별도의 평가 플랫폼을 새로 만들 필요는 없다. 현재 `evaluators/`를 실제 품질 검사기로 확장하고, Promptfoo를 평가 실행·집계·비교 계층으로 활용하는 방향이 적절하다. 단, Promptfoo가 개별 검사를 직접 호출할지, 사전 생성된 결과를 읽을지는 기존 프로젝트 구조를 확인해 결정한다.
