#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

if [ -S "$SOCKET_PATH" ]; then
    SOCKET_GID=$(stat -c '%g' "$SOCKET_PATH" 2>/dev/null)
    
    if [ -n "$SOCKET_GID" ] && [ "$SOCKET_GID" != "0" ]; then
        SOCKET_GROUP=$(getent group "$SOCKET_GID" | cut -d: -f1) || SOCKET_GROUP=""

        if [ -n "$SOCKET_GROUP" ]; then
            echo "[docker-gid] Using existing group '$SOCKET_GROUP' for socket GID: $SOCKET_GID"
        elif getent group docker > /dev/null 2>&1; then
            CURRENT_GID=$(getent group docker | cut -d: -f3)
            echo "[docker-gid] Modifying docker group GID: $CURRENT_GID -> $SOCKET_GID"
            groupmod -g "$SOCKET_GID" docker
            SOCKET_GROUP="docker"
            echo "[docker-gid] GID updated successfully"
        else
            echo "[docker-gid] Creating docker group with GID: $SOCKET_GID"
            groupadd -g "$SOCKET_GID" docker
            SOCKET_GROUP="docker"
            echo "[docker-gid] Docker group created"
        fi
        
        if ! id -nG devuser | grep -Fqw -- "$SOCKET_GROUP"; then
            usermod -aG "$SOCKET_GROUP" devuser
            echo "[docker-gid] Added devuser to '$SOCKET_GROUP' group"
        fi
        
        SOCKET_PERMS=$(stat -c '%a' "$SOCKET_PATH" 2>/dev/null)
        if [ "$SOCKET_PERMS" != "660" ] && [ "$SOCKET_PERMS" != "666" ]; then
            echo "[docker-gid] Fixing socket permissions: $SOCKET_PERMS -> 660"
            chmod 660 "$SOCKET_PATH" 2>/dev/null || true
        fi
    fi
else
    echo "[docker-gid] Docker socket not found at $SOCKET_PATH, skipping GID fix"
fi
