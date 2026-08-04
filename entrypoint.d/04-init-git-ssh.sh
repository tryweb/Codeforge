#!/usr/bin/env bash
set -euo pipefail

DEVUSER_HOME="/home/devuser"
SSH_DIR="$DEVUSER_HOME/.ssh"
GIT_CONFIG_DIR="$DEVUSER_HOME/.config/git"

init_file() {
  local file="$1"

  if [ -f "$file" ]; then
    return 0
  fi

  rm -rf "$file"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  chown devuser:devuser "$file"
  echo "Created: $file"
}

init_dir() {
  local dir="$1"

  if [ -d "$dir" ] && [ -n "$(ls -A "$dir")" ]; then
    return 0
  fi

  mkdir -p "$dir"
  chown -R devuser:devuser "$dir"
  echo "Created: $dir"
}

create_symlink() {
  local target="$1"
  local link="$2"
  local link_dir

  link_dir=$(dirname "$link")

  if [ -L "$link" ]; then
    return 0
  fi

  rm -rf "$link"
  mkdir -p "$link_dir"
  ln -s "$target" "$link"
  chown -h devuser:devuser "$link"
  echo "Symlinked: $link → $target"
}

echo "=== Initializing Git/SSH volumes ==="

init_dir "$SSH_DIR"
init_file "$SSH_DIR/known_hosts"
init_dir "$GIT_CONFIG_DIR"
init_file "$GIT_CONFIG_DIR/.gitconfig"
init_file "$GIT_CONFIG_DIR/.git-credentials"
init_file "$GIT_CONFIG_DIR/config"

create_symlink "$GIT_CONFIG_DIR/.gitconfig" "$DEVUSER_HOME/.gitconfig"
create_symlink "$GIT_CONFIG_DIR/.git-credentials" "$DEVUSER_HOME/.git-credentials"

# 不設定 credential.helper store：git 認證由 glab auth login 流程設定的
# per-host git-credential-glab helper 負責（helper 已 baked 進 image，
# 見 scripts/git-credential-glab）。store 會把 token 以明文寫入
# ~/.git-credentials，且無條件寫入會覆蓋掉 f49b21a 移除它的設計。

# --- Start SSH agent (persistent across sessions) ---
AGENT_ENV="$SSH_DIR/agent.env"
agent_is_usable() {
  [ -f "$AGENT_ENV" ] || return 1
  . "$AGENT_ENV" 2>/dev/null || return 1
  [ -S "${SSH_AUTH_SOCK:-}" ] || return 1

  local status
  if sudo -u devuser env SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l >/dev/null 2>&1; then
    return 0
  else
    status=$?
  fi
  [ "$status" -eq 1 ]
}

if ! agent_is_usable; then
  # Run as devuser so agent socket is accessible to devuser sessions
  sudo -u devuser ssh-agent -s > "$AGENT_ENV" 2>/dev/null
  chmod 600 "$AGENT_ENV"
  echo "Started: ssh-agent (pid $(grep SSH_AGENT_PID "$AGENT_ENV" | cut -d= -f2 | tr -d ';'))"
fi
chown devuser:devuser "$AGENT_ENV"

. "$AGENT_ENV"
loaded_keys=0
skipped_keys=0
for key_file in "$SSH_DIR"/*; do
  [ -f "$key_file" ] || continue
  key_name=$(basename "$key_file")
  case "$key_name" in
    *.pub|known_hosts*|authorized_keys*|config|agent.env)
      continue
      ;;
  esac

  if ! sudo -u devuser ssh-keygen -y -P "" -f "$key_file" </dev/null >/dev/null 2>&1; then
    skipped_keys=$((skipped_keys + 1))
    echo "Skipped: $key_name (not an unencrypted private key)"
    continue
  fi

  chmod 600 "$key_file"
  fingerprint=$(ssh-keygen -lf "$key_file" 2>/dev/null | awk '{print $2}')
  if [ -z "$fingerprint" ]; then
    skipped_keys=$((skipped_keys + 1))
    echo "Skipped: $key_name (fingerprint unavailable)"
    continue
  fi

  loaded_fingerprints=$(sudo -u devuser env SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -l 2>/dev/null || true)
  if printf '%s\n' "$loaded_fingerprints" | awk -v fingerprint="$fingerprint" '$2 == fingerprint { found = 1 } END { exit !found }'; then
    continue
  fi

  if sudo -u devuser env SSH_AUTH_SOCK="$SSH_AUTH_SOCK" ssh-add -q "$key_file" </dev/null 2>/dev/null; then
    loaded_keys=$((loaded_keys + 1))
  else
    skipped_keys=$((skipped_keys + 1))
    echo "Skipped: $key_name (ssh-add failed)"
  fi
done
echo "SSH agent: $loaded_keys key(s) loaded, $skipped_keys skipped"

# Source agent env in .bashrc if not already there
for rcfile in ".bashrc" ".bashenv"; do
  rcpath="$DEVUSER_HOME/$rcfile"
  if [ -f "$rcpath" ] && ! grep -q "agent.env" "$rcpath" 2>/dev/null; then
    cat >> "$rcpath" <<- RCEOF

# SSH agent
if [ -f "\$HOME/.ssh/agent.env" ]; then
  source "\$HOME/.ssh/agent.env"
fi
RCEOF
    chown devuser:devuser "$rcpath"
    echo "Added: ssh-agent source to $rcfile"
  fi
done

echo "=== Git/SSH volumes initialized ==="
echo
