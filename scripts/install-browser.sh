#!/usr/bin/env bash
# Install Chromium for the workflows that render images and video.
#
# WHY: `playwright install --with-deps` also installs system packages from
# Ubuntu's mirrors. On 11 November the runner could not resolve those
# mirrors (a DNS fault at GitHub's end), apt retried each package for six
# minutes, and Daily Content failed before a single script ran. The
# packages it was fetching were extra fonts (Japanese, Chinese, Thai,
# Unifont). The runner image already carries every library Chromium needs.
#
# RULE: try the full install twice, five minutes each at most. If the
# mirrors are still unreachable, install the browser on its own, then
# launch it once. A browser that cannot start still fails here, with a
# message that says so, rather than three steps later inside a render.
set -u

for i in 1 2; do
  if timeout 300 npx playwright install --with-deps chromium; then
    exit 0
  fi
  echo "Browser install with system packages failed (attempt $i of 2)."
  [ "$i" -lt 2 ] && sleep 30
done

echo "Ubuntu's package mirrors are unreachable. Installing the browser on its own."
npx playwright install chromium || exit 1

if node -e "require('playwright').chromium.launch().then(b => b.close())"; then
  echo "Chromium starts without the extra system packages. Carrying on."
else
  echo "Chromium was installed but cannot start without the system packages. Re-run this workflow once GitHub's network recovers."
  exit 1
fi
