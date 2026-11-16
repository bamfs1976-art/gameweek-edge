#!/bin/bash
# Installs the graphify CLI in fresh cloud containers and builds the code
# graph if it is missing, so the project hooks have a graph to point to.
export PATH="$HOME/.local/bin:$PATH"
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install 'graphifyy[sql]' >/dev/null 2>&1
  elif command -v pipx >/dev/null 2>&1; then
    pipx install 'graphifyy[sql]' >/dev/null 2>&1
  fi
fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if command -v graphify >/dev/null 2>&1 && [ ! -f graphify-out/graph.json ]; then
  graphify update . >/dev/null 2>&1
fi
exit 0
