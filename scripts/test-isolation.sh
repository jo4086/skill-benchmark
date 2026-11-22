#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GROUP="${1:-baseline}"

if [[ "$GROUP" == public ]]; then
  INDEX="$ROOT/environments/index.json"
  if [[ ! -f "$INDEX" ]]; then
    echo "Environment index is missing; run pnpm run setup first" >&2
    exit 1
  fi
  if ! PUBLIC_LIST="$(node -e '
    const fs = require("node:fs");
    const index = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (index.schemaVersion !== 1 || !Array.isArray(index.environments)) throw new Error("Invalid environment index");
    for (const entry of index.environments) {
      if (entry.id === "baseline" || entry.id === "codex-workspace") continue;
      if (entry.source?.kind !== "git" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) continue;
      console.log(entry.id);
    }
  ' "$INDEX")"; then
    echo "Could not read installed public environments" >&2
    exit 1
  fi
  if [[ -z "$PUBLIC_LIST" ]]; then
    echo "No public Skill environment is installed; run pnpm run setup first" >&2
    exit 1
  fi
  mapfile -t PUBLIC_IDS <<< "$PUBLIC_LIST"
  if [[ -n "${2:-}" ]]; then
    GROUP="$2"
  elif (( ${#PUBLIC_IDS[@]} == 1 )); then
    GROUP="${PUBLIC_IDS[0]}"
  elif [[ -t 0 ]]; then
    echo "Select an installed public Skill environment:"
    for index in "${!PUBLIC_IDS[@]}"; do
      printf '  %d. %s\n' "$((index + 1))" "${PUBLIC_IDS[index]}"
    done
    read -r -p 'Selection: ' choice
    if [[ ! "$choice" =~ ^[0-9]+$ ]] || (( 10#$choice < 1 || 10#$choice > ${#PUBLIC_IDS[@]} )); then
      echo "Invalid public environment selection" >&2
      exit 1
    fi
    GROUP="${PUBLIC_IDS[$((10#$choice - 1))]}"
  else
    echo "Select a public environment by name: pnpm run test:public <id>" >&2
    exit 1
  fi
  found=false
  for candidate in "${PUBLIC_IDS[@]}"; do
    if [[ "$GROUP" == "$candidate" ]]; then found=true; break; fi
  done
  if [[ "$found" != true ]]; then
    echo "Public environment $GROUP is not installed" >&2
    exit 1
  fi
fi

if [[ "${1:-baseline}" != public ]]; then
  case "$GROUP" in
  baseline | codex-workspace) ;;
  *)
    echo "Invalid group: $GROUP" >&2
    exit 1
    ;;
  esac
fi

REAL_HOME="$HOME"
TEST_HOME="$ROOT/environments/$GROUP"
TEST_CODEX_HOME="$TEST_HOME/.codex"

if [[ ! -f "$TEST_HOME/environment.json" || ! -d "$TEST_HOME/.agents/skills" || ! -d "$TEST_CODEX_HOME" ]]; then
  echo "Environment $GROUP is not installed; run pnpm run setup first" >&2
  exit 1
fi

# 홈 경로가 실제 사용자 홈을 가리키지 않는지 확인
if [[ "$(realpath "$TEST_HOME")" == "$(realpath "$REAL_HOME")" ]]; then
  echo "Isolation failed"
  exit 1
fi

WORK_DIR="$(node "$ROOT/runner/storage.mjs" manual "$GROUP")"
echo "Codex home: $TEST_CODEX_HOME"
echo "Manual Codex working directory: $WORK_DIR"
cd "$WORK_DIR"

env \
  HOME="$TEST_HOME" \
  CODEX_HOME="$TEST_CODEX_HOME" \
  XDG_CONFIG_HOME="$TEST_HOME/.config" \
  codex --no-daemon
