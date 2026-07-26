#!/usr/bin/env bash
set -euo pipefail

# Validate the GID-conflict path without changing the host's groups or socket.
# Usage: ./test/test-docker-gid.sh [image]

IMAGE="${1:-ai-engkit:ci}"
CONTAINER="docker-gid-test-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --name "$CONTAINER" --user root --entrypoint /bin/bash \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -d "$IMAGE" -c 'sleep 300' >/dev/null

docker exec -i "$CONTAINER" bash <<'EOF'
set -euo pipefail

SOCKET_PATH=/tmp/docker-gid-test.sock
CONFLICT_GID=""
for candidate in 2000 2001 2002 2003 2004; do
  if ! getent group "$candidate" >/dev/null 2>&1; then
    CONFLICT_GID="$candidate"
    break
  fi
done
[ -n "$CONFLICT_GID" ]

groupadd -g "$CONFLICT_GID" socket-conflict
export CONFLICT_GID
python3 - <<'PY'
import os
import socket

path = "/tmp/docker-gid-test.sock"
try:
    os.unlink(path)
except FileNotFoundError:
    pass

sock = socket.socket(socket.AF_UNIX)
sock.bind(path)
sock.close()
os.chown(path, 0, int(os.environ["CONFLICT_GID"]))
os.chmod(path, 0o660)
PY

DOCKER_SOCKET_PATH="$SOCKET_PATH" /entrypoint.d/03-fix-docker-gid.sh

SOCKET_GROUP=$(getent group "$CONFLICT_GID" | cut -d: -f1)
id -nG devuser | grep -Fqw -- "$SOCKET_GROUP"
[ "$(stat -c '%g' "$SOCKET_PATH")" = "$CONFLICT_GID" ]
su -s /bin/bash devuser -c "test -r '$SOCKET_PATH'"
EOF

echo "Docker socket GID conflict handling passed"
