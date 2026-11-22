# Bootstrap 사용과 계약

Bootstrap은 Runner가 사용할 환경을 구성한다. [루트 README](../README.md)의 비교 원칙과 [아키텍처](../ARCHITECTURE.md)를 따른다. 이 구현은 Skill 디렉터리를 Codex가 찾는 `.agents/skills/`에 복사한다. 공개 저장소의 공식 플러그인 설치 프로그램을 실행하거나 외부 명령을 Skill 내용에 맞게 변환하지 않는다.

## 명령

```sh
pnpm run setup --list
pnpm run setup --public none
pnpm run setup --public superpowers,anthropics-skills
pnpm run setup --public mattpocock-skills --local-workspace /path/to/codex-workspace
pnpm run setup --public none --copy-auth
pnpm run auth:copy  # 이미 설치한 환경에 인증 파일만 복사
pnpm verify
```

`pnpm run setup`만 실행하면 공개 모음 선택을 묻는다. 비대화형 셸에서는 `--public`을 명시해야 한다. Baseline과 codex-workspace는 항상 포함된다. `pnpm setup`은 pnpm 자체 명령이므로 사용하지 않는다.

`--common-skills-dir /path/to/skills`는 명시한 로컬 Skill 모음을 **모든** 비교군에 동일하게 복사한다. 기본값은 빈 모음이다. Codex 자체 제공 Skill은 별도 복사하지 않는다. 이 옵션을 사용하면 설치 원본 경로와 내용 해시가 환경 기록에 남는다. 같은 이름의 Skill이 다른 원본에도 있으면 설치를 중단한다.

기존 `environments/<id>/`에 Bootstrap 기록이 없거나 내용이 달라진 경우, 대화형 실행은 충돌한 환경을 모두 보여 주고 보관 여부를 묻는다. 거절하면 기존 환경을 변경하지 않고 종료한다. 비대화형 실행은 중단하며, 내용을 확인한 뒤 `--archive-existing`을 명시해야 한다. 보관에 동의한 기존 환경은 `environments/.backups/`로 이동하고 자동 삭제되지 않는다. Bootstrap은 Skill을 실제로 호출하거나 Hook을 실행하지 않는다.

### 기존 Codex 로그인 재사용

대화형 `setup`은 설치가 끝난 뒤 현재 사용자의 파일 기반 Codex 로그인 복사를 제안한다. `--copy-auth`는 이 질문 없이 복사한다. 이미 설치한 환경에는 `pnpm run auth:copy`를 사용한다. 원본은 현재 `CODEX_HOME/auth.json` 또는 기본 `~/.codex/auth.json`이며, 파일 기반 로그인이 없으면 복사할 수 없다. 원본을 수정하지 않고 Bootstrap이 관리하는 각 환경의 `.codex/auth.json`에 **권한 `0600`인 별도 파일**로 복사한다. 이미 인증 파일이 있는 환경은 덮어쓰지 않는다. 인증 내용과 해시는 설치 기록·로그에 넣지 않는다.

복사본은 원본과 같은 계정으로 실행하지만 이후 파일과 토큰 갱신 상태는 환경마다 달라질 수 있다. 인증이 만료되거나 현재 Codex가 키링을 사용하면 해당 환경에서 로그인해야 한다. 모든 `environments/`와 `auth.json`은 Git에서 제외된다.

## 출처와 설치

[`sources.json`](./sources.json)은 `schemaVersion: 1`, 필수 `workspace`, 선택 가능한 `public` 배열로 구성된다. 각 Git 출처에는 고유 `id`, `repository`, 40자리 고정 `commit`, `skillsPath`가 필요하다. 추천 후보의 커밋은 설정 파일에 고정되어 있다. 새 공개 모음을 추가할 때 저장소 구조와 Codex 호환성을 확인하고 같은 필드를 등록한다.

Bootstrap은 `git fetch --depth 1`로 정확한 커밋을 가져와 HEAD를 확인한다. `skillsPath` 아래에서 `SKILL.md`가 있는 디렉터리를 재귀적으로 찾고 각 Skill의 전체 디렉터리를 환경의 `.agents/skills/<이름>/`에 복사한다. 경로가 서로 다른 저장소도 지원하지만 이름 충돌, 필수 메타데이터 누락, 심볼릭 링크는 설치 실패로 처리한다. 외부 의존성 설치와 공개 저장소의 자체 설정 스크립트 실행은 하지 않는다.

codex-workspace에는 `templates/global-AGENTS.md`를 환경의 `.agents/AGENTS.md`로, `hooks/hooks.json`과 `hooks/git/`을 `.agents/` 아래로 복사한다. 환경의 `.codex/AGENTS.md`는 `../.agents/AGENTS.md`를 가리키는 심볼릭 링크다. 저장소 루트 `AGENTS.md`는 설치 원본으로 사용하지 않는다. 공개 모음은 현재 Skill 디렉터리만 복사한다. 이 방식은 각 저장소의 공식 플러그인 전체 설치와 동일하다고 보장하지 않는다.

## Runner에 제공하는 정보

설치된 각 환경의 `environment.json`과 `environments/index.json`은 `schemaVersion: 1`을 사용한다. 인덱스에는 환경 식별자, 저장소 루트 기준 상대 `home`·`codexHome`·`xdgConfigHome`, 원본, 환경 기록 경로가 있다. 환경 기록에는 Skill 이름 목록, 원본 URL과 커밋 또는 로컬 경로, 공통 Skill 출처, 설치 당시 Codex 버전, `.agents` 내용 해시가 있다. Runner는 이 정보만 읽고 설치를 수행하지 않도록 설계한다.

`pnpm verify`는 인덱스와 환경 기록의 일치, 필수 환경, 현재 `sources.json`의 고정 커밋, 설치 당시와 현재의 Codex 버전, 디렉터리·Skill 목록·내용 해시, codex-workspace의 지침 연결을 검사한다. 인증 상태와 Codex가 Skill 또는 Hook을 실제로 사용했는지는 검사하지 않는다. `environments/` 전체와 그 백업은 Git에서 제외된다.
