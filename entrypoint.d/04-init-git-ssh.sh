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
if [ ! -f "$AGENT_ENV" ] || ! ( . "$AGENT_ENV" 2>/dev/null && [ -S "$SSH_AUTH_SOCK" ] 2>/dev/null ); then
  # Run as devuser so agent socket is accessible to devuser sessions
  sudo -u devuser ssh-agent -s > "$AGENT_ENV" 2>/dev/null
  chmod 600 "$AGENT_ENV"
  echo "Started: ssh-agent (pid $(grep SSH_AGENT_PID "$AGENT_ENV" | cut -d= -f2 | tr -d ';'))"
fi

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
