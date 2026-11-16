#!/bin/bash
# Installs the graphify CLI in fresh cloud containers so the project hooks work.
export PATH="$HOME/.local/bin:$PATH"
command -v graphify >/dev/null 2>&1 && exit 0
if command -v uv >/dev/null 2>&1; then
  uv tool install graphifyy >/dev/null 2>&1
elif command -v pipx >/dev/null 2>&1; then
  pipx install graphifyy >/dev/null 2>&1
fi
exit 0
