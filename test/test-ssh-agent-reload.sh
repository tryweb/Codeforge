#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-ai-engkit:ci}"
SUFFIX="$$-$(date +%s)"
CONTAINER="ssh-agent-reload-test-$SUFFIX"
VOLUME="ssh-agent-reload-test-$SUFFIX"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$VOLUME" >/dev/null
docker run --name "$CONTAINER" -d \
  -v "$VOLUME:/home/devuser/.ssh" \
  "$IMAGE" sleep 300 >/dev/null

if ! docker exec --user devuser -i "$CONTAINER" env -u BASH_ENV -u CLAUDE_ENV_FILE bash <<'EOF'
set -euo pipefail

for _ in {1..30}; do
  . /home/devuser/.ssh/agent.env 2>/dev/null || true
  if [ -S "${SSH_AUTH_SOCK:-}" ] && sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l >/dev/null 2>&1; then
    break
  else
    status=$?
    if [ -S "${SSH_AUTH_SOCK:-}" ] && [ "$status" -eq 1 ]; then
      break
    fi
  fi
  sleep 1
done
. /home/devuser/.ssh/agent.env
[ -S "$SSH_AUTH_SOCK" ]

install -d -m 700 /home/devuser/.ssh
sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-keygen -q -t ed25519 -N "" -f /home/devuser/.ssh/reload-key
fingerprint=$(ssh-keygen -lf /home/devuser/.ssh/reload-key.pub | awk '{print $2}')
if sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l 2>/dev/null | grep -Fq "$fingerprint"; then
  echo "reload-key was loaded before restart" >&2
  exit 1
fi
sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" SSH_ASKPASS=/bin/false DISPLAY=:0 ssh-keygen -q -t ed25519 -N "test-passphrase" -f /home/devuser/.ssh/protected-key
printf "%s\n" "known-host-data" > /home/devuser/.ssh/known_hosts
printf "%s\n" "agent-env-data" > /home/devuser/.ssh/custom-config
chmod 600 /home/devuser/.ssh/known_hosts /home/devuser/.ssh/custom-config /home/devuser/.ssh/protected-key
EOF
then
  echo "FAIL: initial SSH-agent setup" >&2
  exit 1
fi

if ! docker restart "$CONTAINER" >/dev/null; then
  echo "FAIL: container restart" >&2
  exit 1
fi

if ! docker exec --user devuser -i "$CONTAINER" env -u BASH_ENV -u CLAUDE_ENV_FILE bash <<'EOF'
set -euo pipefail

for _ in {1..30}; do
  . /home/devuser/.ssh/agent.env 2>/dev/null || true
  if [ -S "${SSH_AUTH_SOCK:-}" ] && sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l >/dev/null 2>&1; then
    break
  else
    status=$?
    if [ -S "${SSH_AUTH_SOCK:-}" ] && [ "$status" -eq 1 ]; then
      break
    fi
  fi
  sleep 1
done
. /home/devuser/.ssh/agent.env
[ -S "$SSH_AUTH_SOCK" ]

fingerprint=$(ssh-keygen -lf /home/devuser/.ssh/reload-key.pub | awk '{print $2}')
if ! sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l | grep -Fq "$fingerprint"; then
  echo "reload-key was not restored after restart" >&2
  exit 1
fi
if sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" SSH_ASKPASS=/bin/false DISPLAY=:0 ssh-add /home/devuser/.ssh/protected-key </dev/null 2>/dev/null; then
  echo "protected key was unexpectedly loaded" >&2
  exit 1
fi
if ! test -f /home/devuser/.ssh/known_hosts; then
  echo "known_hosts was not preserved" >&2
  exit 1
fi
if ! test -f /home/devuser/.ssh/custom-config; then
  echo "custom-config was not preserved" >&2
  exit 1
fi
before=$(sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l | grep -Fc "$fingerprint")
if [ "$before" -ne 1 ]; then
  echo "reload-key identity count before idempotency run: $before" >&2
  exit 1
fi
sudo /entrypoint.d/04-init-git-ssh.sh
after=$(sudo -u devuser env HOME=/home/devuser SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l | grep -Fc "$fingerprint")
if [ "$after" -ne 1 ]; then
  echo "reload-key identity count after idempotency run: $after" >&2
  exit 1
fi
EOF
then
  echo "FAIL: SSH-agent reload or idempotency assertion" >&2
  exit 1
fi

LOGS=$(docker logs "$CONTAINER" 2>&1 || true)
if printf '%s\n' "$LOGS" | grep -Fq "test-passphrase"; then
  echo "FAIL: passphrase appeared in container logs" >&2
  exit 1
fi
if ! printf '%s\n' "$LOGS" | grep -Fq "Skipped: protected-key"; then
  echo "FAIL: protected key skip was not reported" >&2
  exit 1
fi

echo "PASS: SSH-agent reload after container restart"
