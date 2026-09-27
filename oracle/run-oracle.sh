#!/usr/bin/env bash
# run-oracle.sh — headless-PoB2 оракул, Linux-вариант (используется в CI SourceCraft).
# Использование:
#   ./run-oracle.sh <каталог-src PoB2>                # снимок + сверка с golden
#   ./run-oracle.sh <каталог-src PoB2> --update-golden  # пересоздать golden
# Требования: luajit (5.1/LuaJIT 2.x), C-модуль luautf8, node (для сверки).
# Ошибка в любом шаге => ненулевой exit (CI краснеет).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
POB_SRC="${1:-}"
MODE="${2:-}"

if [ -z "$POB_SRC" ] || [ ! -f "$POB_SRC/HeadlessWrapper.lua" ]; then
  echo "usage: $0 <pob2-src-dir> [--update-golden]" >&2
  echo "  <pob2-src-dir> — каталог src репозитория PathOfBuilding-PoE2 (с HeadlessWrapper.lua)" >&2
  exit 2
fi

OUT="$ROOT/oracle-output.jsonl"
GOLDEN="$ROOT/golden-oracle.json"

# Тот же набор путей, что в .busted самого PoB2 (+ ?.lua формы для cwd=src)
cd "$POB_SRC"
export CI=true                      # CI-режим PoB2: без ModCache (HeadlessWrapper.lua)
export LUA_PATH='?.lua;?\init.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua'
# LUA_CPATH не задаём: luautf8 ставится в системное дерево luajit (luarocks).

luajit "$ROOT/oracle.lua" > "$OUT"

if [ "$MODE" = "--update-golden" ]; then
  node "$ROOT/update-golden.mjs" "$OUT" "$GOLDEN"
  echo "Golden обновлён: $GOLDEN"
else
  node "$ROOT/compare-golden.mjs" "$OUT" "$GOLDEN"
  echo "OK: сценарии сходятся с golden"
fi
