# FE-01 사용자 평가 항목

이 문서는 REST Countries의 **화면을 직접 보고 평가하는 사용자용 기록지**다. 두 결과를 각각 확인하고 아래 칸을 채운다. 기능·정적·AI 평가 결과는 [자동 평가 기록](./automatic-evaluation.md)에 있다.

## 실행과 원본 시안

현재 준비된 미리보기는 임시 경로에 있다. 두 터미널에서 각각 실행한다.

```bash
cd /tmp/skill-benchmark-visual-review-MuSIbl/baseline
pnpm dev --host 127.0.0.1 --port 5173
```

```bash
cd /tmp/skill-benchmark-visual-review-MuSIbl/codex-workspace
pnpm dev --host 127.0.0.1 --port 5174
```

Baseline은 `http://127.0.0.1:5173/`, codex-workspace는 `http://127.0.0.1:5174/`에서 연다. 원본 시안 8장과 스타일 가이드는 현재 `/tmp/skill-benchmark-visual-review-MuSIbl/reference-design/`에 풀어 두었다. 원본은 [과제 ZIP](../../../../tasks/FE-01/source/rest-countries-api-with-color-theme-switcher-master.zip)에 있다. `/tmp`의 미리보기와 시안 복사본은 재부팅 후 사라질 수 있다.

원본 시안 너비인 **1440px·375px**에서 비교하고, **320px**에서는 화면 깨짐을 확인한다. 두 결과에 같은 브라우저와 배율을 사용한다. 아래 체크박스는 **해당 환경에서 통과했을 때만** 표시한다. 문제나 미확인은 체크하지 않고 마지막 표에 ID, 화면 너비, 실제 모습, 캡처 경로를 적는다.

| 평가 정보 | 기록 |
| --- | --- |
| 날짜·브라우저·배율 |  |
| Baseline 화면 캡처 위치 |  |
| codex-workspace 화면 캡처 위치 |  |

## 밝은 테마와 화면 배치

### V01 · 데스크톱 홈

1440px에서 `desktop-design-home-light.jpg`와 헤더, 검색창, 지역 필터, 카드 열 수·폭·간격·그림자·정렬을 비교한다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V02 · 모바일 홈

375px에서 `mobile-design-home-light.jpg`와 검색창·필터의 순서, 카드 폭·간격, 좌우 여백을 비교한다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V03 · 데스크톱 상세

Germany를 열고 1440px에서 `desktop-design-detail-light.jpg`와 국기 크기·비율, 정보 묶음, 국경 국가 버튼 배치를 비교한다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V04 · 모바일 상세

Germany를 열고 375px에서 `mobile-design-detail-light.jpg`와 국기·국가명·정보·국경 버튼의 순서와 여백을 비교한다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V05 · 글꼴과 정보 위계

원본 스타일 가이드의 Nunito Sans, 굵기 300·600·800을 참고해 제목·카드·상세 본문의 크기, 굵기, 줄 간격, 읽기 쉬움을 확인한다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V06 · 색상과 국기

밝은 테마의 배경·카드·입력·본문 대비가 시안에 맞는지 본다. Germany와 다른 형태의 국기 하나를 열어 이미지가 깨지거나 왜곡·잘림 없이 보이는지 확인한다. 아이콘 모양은 원본과 완전히 같을 필요는 없다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

## 어두운 테마와 다양한 상태

### V07 · 어두운 테마

두 구현 모두 테마 전환이 있다. 홈·상세를 1440px과 375px에서 네 어두운 시안과 비교한다. 배경·표면·글자·입력·버튼이 함께 전환되고 읽을 수 있어야 한다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V08 · 중간·좁은 화면

320px과 375–1440px 사이의 임의 너비에서 가로 스크롤, 카드·텍스트 겹침, 잘린 정보·버튼, 화면 밖으로 나간 필터 메뉴가 없는지 본다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V09 · 상태별 배치

검색 결과가 1개일 때, 결과가 없을 때, 지역 필터 메뉴가 열렸을 때, 국경 버튼이 많은 상세 화면에서 정렬과 여백이 무너지지 않는지 본다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

### V10 · 키보드 초점 표시

Tab으로 검색·필터·카드·Back·국경 링크·테마 버튼을 이동한다. 밝은·어두운 테마에서 현재 초점이 눈에 보이고 표시가 잘리지 않는지 본다.

- [ ] Baseline 통과
- [ ] codex-workspace 통과

## 문제·미확인 기록

| 환경 | 항목 ID | 문제/미확인 | 화면 너비와 상태 | 실제 모습·캡처 경로 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

| 최종 의견 | 기록 |
| --- | --- |
| Baseline |  |
| codex-workspace |  |
| 두 결과를 비교한 근거 |  |

시각 평가는 자동 품질 점수에 포함되지 않는다. 상대적으로 나은 결과를 선택할 때는 해당 항목과 화면 근거를 적는다.
