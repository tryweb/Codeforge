#!/usr/bin/env bash
set -euo pipefail

SOCKET_PATH="/var/run/docker.sock"

if [ -S "$SOCKET_PATH" ]; then
    SOCKET_GID=$(stat -c '%g' "$SOCKET_PATH" 2>/dev/null)
    
    if [ -n "$SOCKET_GID" ] && [ "$SOCKET_GID" != "0" ]; then
        if getent group docker > /dev/null 2>&1; then
            CURRENT_GID=$(getent group docker | cut -d: -f3)
            if [ "$CURRENT_GID" != "$SOCKET_GID" ]; then
                echo "[docker-gid] Modifying docker group GID: $CURRENT_GID -> $SOCKET_GID"
                groupmod -g "$SOCKET_GID" docker
                echo "[docker-gid] GID updated successfully"
            else
                echo "[docker-gid] Docker group GID matches socket: $SOCKET_GID"
            fi
        else
            echo "[docker-gid] Creating docker group with GID: $SOCKET_GID"
            if groupadd -g "$SOCKET_GID" docker 2>/dev/null; then
                echo "[docker-gid] Docker group created"
            else
                # GID conflict — find a free fallback GID (common reserved range)
                echo "[docker-gid] GID $SOCKET_GID unavailable (conflict), finding fallback..."
                fallback=""
                for try in 999 998 997 996 995; do
                    if ! getent group "$try" > /dev/null 2>&1; then
                        fallback="$try"
                        break
                    fi
                done
                if [ -n "$fallback" ]; then
                    echo "[docker-gid] Creating docker group with fallback GID: $fallback"
                    groupadd -g "$fallback" docker
                    echo "[docker-gid] Docker group created (GID $fallback)"
                else
                    echo "[docker-gid] WARNING: Could not create docker group, continuing without it"
                fi
            fi
        fi
        
        if ! id -nG devuser | grep -qw docker; then
            usermod -aG docker devuser
            echo "[docker-gid] Added devuser to docker group"
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