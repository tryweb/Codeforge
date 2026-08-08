#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Reconcile OpenChamber project registrations against the
# workspace directory listing after every container start.
#
# Why this exists: OpenChamber's validateProjectEntries
# (settings-runtime.js) drops any registration whose path
# fails fs.stat at the moment a projects-bearing settings
# persist runs. At container boot the workspace bind mount
# may not be fully visible yet (verified incident: 2026-08-08
# pruned 22 of 26 registrations 3s after start, dirs were
# fine). This script re-adds whatever the transient window
# dropped. Add-only and idempotent — safe to run anytime.
#
# Strategy:
#   1. Run reconcile once synchronously (workspace is usually
#      ready at this point; repairing before OpenChamber boots
#      means it never prunes at all).
#   2. Background a bounded retry loop that waits for the
#      workspace to become visible and reconciles again, in
#      case the mount was slow (the exact incident race).
#
# Honors $SETTINGS / $WORKSPACE when set (same overrides as
# the reconcile script) — used by tests and manual recovery.
# ──────────────────────────────────────────────────────────
set -u

RECONCILE=/opt/ai-engkit/scripts/reconcile-openchamber-projects.sh
WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"

if [ ! -x "$RECONCILE" ]; then
  echo "[reconcile-openchamber] script not found, skipping"
  exit 0
fi

workspace_ready() {
  [ -d "$WORKSPACE" ] && \
    [ -n "$(find "$WORKSPACE" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)" ]
}

report() {
  local out="$1" added
  added=$(printf '%s' "$out" | sed -n 's/.*"added"[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -1)
  if [ -n "$added" ] && [ "$added" -gt 0 ] 2>/dev/null; then
    echo "[reconcile-openchamber] restored ${added} project registration(s)"
  elif [ -n "$added" ]; then
    echo "[reconcile-openchamber] consistent, nothing to restore"
  else
    echo "[reconcile-openchamber] unexpected output: $out"
  fi
}

# 1) Synchronous first pass — fast, repairs the common case before serve starts.
if workspace_ready; then
  report "$("$RECONCILE" 2>&1 || true)"
else
  echo "[reconcile-openchamber] workspace not visible yet, deferring to background retry"
fi

# 2) Bounded background retry — covers the boot-time mount-visibility window.
(
  for _ in 1 2 3 4 5 6 7 8; do
    sleep 5
    if workspace_ready; then
      out=$("$RECONCILE" 2>&1 || true)
      report "$out"
      added=$(printf '%s' "$out" | sed -n 's/.*"added"[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -1)
      if [ -n "$added" ] && [ "$added" -eq 0 ] 2>/dev/null; then
        exit 0
      fi
    fi
  done
  echo "[reconcile-openchamber] gave up after retries (workspace never became visible)"
) &
disown 2>/dev/null || true

exit 0
