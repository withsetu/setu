#!/usr/bin/env bash
# SessionStart hook (#1037) — make a Claude Code on the web container able to run
# the §3.3 verification ladder, e2e included.
#
# A fresh cloud container ships chromium build 1194 under /opt/pw-browsers, while
# the pinned @playwright/test resolves browsers at a different build, and webkit is
# absent along with its system libraries. Without this, `pnpm e2e` cannot launch a
# browser at all — which takes the wrong-actor gate (CLAUDE.md card #5) offline.
#
# Remote-only: local checkouts and CI manage their own browsers and are untouched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

echo "[session-start] installing workspace dependencies"
pnpm install --frozen-lockfile

# `playwright install` is a no-op for builds already present, so this stays cheap on
# a warm container and is safe to re-run.
echo "[session-start] installing Playwright browsers for the pinned version"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 pnpm exec playwright install chromium webkit

# webkit needs system libraries the base image lacks. Root is available in the cloud
# container; anywhere it is not, skip rather than fail the session — chromium still runs.
if [ "$(id -u)" = "0" ]; then
  echo "[session-start] installing webkit system dependencies"
  pnpm exec playwright install-deps webkit
else
  echo "[session-start] not root — skipping webkit system deps (chromium e2e still runs)"
fi

echo "[session-start] ready: pnpm test / pnpm typecheck / pnpm lint / pnpm e2e"
