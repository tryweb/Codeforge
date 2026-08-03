#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://raw.githubusercontent.com/tryweb/ai-engkit/main"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ──────────────────────────────────────────────────────────
# Color helpers (disabled if not terminal)
# ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

info()  { echo -e "  ${CYAN}ℹ${NC}  $1"; }
ok()    { echo -e "  ${GREEN}✅${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠️${NC}  $1"; }
fail()  { echo -e "  ${RED}❌${NC} $1"; exit 1; }
header() {
    echo
    echo -e "${BOLD}========================================${NC}"
    echo -e "${BOLD} $1${NC}"
    echo -e "${BOLD}========================================${NC}"
}

# ──────────────────────────────────────────────────────────
# Portable download helper (curl preferred, wget fallback)
# NOTE: wget -O is the output file, -o is the log file
# ──────────────────────────────────────────────────────────
download() {
    local url="$1" dest="$2"
    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o "$dest"
    elif command -v wget &>/dev/null; then
        wget -qO "$dest" "$url"
    else
        return 1
    fi
}

# ──────────────────────────────────────────────────────────
# System requirement checks (shared with install.sh)
# ──────────────────────────────────────────────────────────
check_system() {
    header "1. Checking System Hardware Specifications"

    if [ "${SKIP_SYSTEM_CHECK:-0}" = "1" ]; then
        warn "SKIP_SYSTEM_CHECK=1 set, skipping hardware checks"
        return 0
    fi

    local RAM_KB cg_limit warnings=0
    CPU_CORES=$(nproc 2>/dev/null || echo 0)

    # Containers report host memory via /proc/meminfo — prefer cgroup limit when set
    RAM_KB=""
    if [ -r /sys/fs/cgroup/memory.max ]; then
        cg_limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || true)
        if [ -n "$cg_limit" ] && [ "$cg_limit" != "max" ] && \
           [[ "$cg_limit" =~ ^[0-9]+$ ]] && [ "$cg_limit" -lt $((1 << 40)) ]; then
            RAM_KB=$((cg_limit / 1024))   # cgroup v2 limit is in bytes
        fi
    elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
        cg_limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || true)
        if [ -n "$cg_limit" ] && [[ "$cg_limit" =~ ^[0-9]+$ ]] && [ "$cg_limit" -lt $((1 << 40)) ]; then
            RAM_KB=$((cg_limit / 1024))   # cgroup v1 limit is in bytes
        fi
    fi
    if [ -z "$RAM_KB" ] || [ "$RAM_KB" -le 0 ] 2>/dev/null; then
        RAM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)
    fi
    if [ -z "$RAM_KB" ] || [ "$RAM_KB" -le 0 ] 2>/dev/null; then
        RAM_KB=$(free -k 2>/dev/null | awk '/^Mem:/ {print $2}' || true)
    fi
    RAM_KB="${RAM_KB:-0}"

    DISK_KB=$(df -Pk / 2>/dev/null | tail -1 | awk '{print $4}')
    DISK_GB=$((DISK_KB / 1024 / 1024))

    # One decimal place so e.g. 3.9 GB is not truncated into a failing 3 GB
    RAM_GB=$(awk -v kb="$RAM_KB" 'BEGIN{printf "%.1f", kb/1048576}')
    RAM_GB_INT=$((RAM_KB / 1024 / 1024))

    echo "  CPU cores: $CPU_CORES  |  RAM: ${RAM_GB} GB  |  Disk: ${DISK_GB} GB"

    if [ "$CPU_CORES" -lt 2 ]; then
        fail "Insufficient CPU cores (requires at least 2 cores)"
    fi
    # Warn and continue below the recommended 4 GB; hard-fail only far below it
    if [ "$RAM_GB_INT" -lt 2 ]; then
        fail "Insufficient RAM (requires at least 2 GB; 4 GB recommended)"
    elif [ "$RAM_GB_INT" -lt 4 ]; then
        warn "RAM below recommended 4 GB — continuing, but performance may be limited"
        warnings=1
    fi
    if [ "$DISK_GB" -lt 5 ]; then
        fail "Insufficient disk space (requires at least 5 GB for upgrade)"
    fi

    CPU_FLAGS=$(grep -m1 '^flags' /proc/cpuinfo 2>/dev/null || echo "")
    HAS_AVX=false; HAS_AVX2=false
    echo "$CPU_FLAGS" | grep -qw 'avx'  && HAS_AVX=true
    echo "$CPU_FLAGS" | grep -qw 'avx2' && HAS_AVX2=true

    if [ "$HAS_AVX" = "false" ] || [ "$HAS_AVX2" = "false" ]; then
        echo "  ❌ CPU lacks required SIMD instruction sets:"
        [ "$HAS_AVX"  = "false" ] && echo "     - AVX not supported"
        [ "$HAS_AVX2" = "false" ] && echo "     - AVX2 not supported"
        fail "Unsupported CPU, please refer to install.sh for full details"
    fi

    if [ "$warnings" -eq 1 ]; then
        warn "System meets minimum requirements, but some specs are below recommendation"
    else
        ok "System specifications meet requirements"
    fi
}

check_docker() {
    header "2. Checking Docker Environment"

    command -v docker &>/dev/null || fail "Docker not installed"
    ok "Docker: $(docker --version | head -1)"

    if command -v docker compose &>/dev/null; then
        ok "Docker Compose V2 installed"
    else
        fail "Docker Compose V2 not installed"
    fi

    [ -S /var/run/docker.sock ] || fail "Docker socket does not exist"
    docker info &>/dev/null || fail "Cannot connect to Docker daemon"
    ok "Docker daemon running normally"

    command -v curl &>/dev/null || command -v wget &>/dev/null || fail "Missing curl or wget"
    ok "Network tools installed"
}

# ──────────────────────────────────────────────────────────
# Backup existing files
# ──────────────────────────────────────────────────────────
backup_files() {
    header "3. Backing Up Existing Configuration Files"

    local backup_dir="backup_${TIMESTAMP}"
    mkdir -p "$backup_dir"

    for f in docker-compose.yml .env; do
        if [ -f "$f" ]; then
            cp "$f" "${backup_dir}/${f}"
            ok "${f} → ${backup_dir}/${f}"
        else
            info "${f} does not exist, skipping backup"
        fi
    done

    # ── Prune old backups per retention setting ──
    local retention
    retention=$(grep -E "^BACKUP_RETENTION=" .env 2>/dev/null | head -1 | cut -d= -f2 || true)
    retention="${retention:-5}"

    if ! [[ "$retention" =~ ^[0-9]+$ ]] || [ "$retention" -lt 1 ]; then
        retention=5
    fi

    local backups=()
    while IFS= read -r d; do
        [ -n "$d" ] && backups+=("$d")
    done < <(find . -maxdepth 1 -type d -name 'backup_*' 2>/dev/null | sort)

    if [ "${#backups[@]}" -gt "$retention" ]; then
        local to_remove=$(( ${#backups[@]} - retention ))
        info "Keeping the most recent ${retention} backups, will delete ${to_remove} old backups"
        for ((i=0; i<to_remove; i++)); do
            rm -rf "${backups[$i]}"
            ok "Old backup deleted: ${backups[$i]}"
        done
    fi
}

# ──────────────────────────────────────────────────────────
# Update docker-compose.yml from upstream
# ──────────────────────────────────────────────────────────
update_compose() {
    header "4. Updating docker-compose.yml"

    echo "  Downloading latest docker-compose.yml..."
    if download "$REPO_URL/docker-compose.yml" docker-compose.yml.new && [ -s docker-compose.yml.new ]; then
        mv docker-compose.yml.new docker-compose.yml
        ok "docker-compose.yml updated"
    else
        rm -f docker-compose.yml.new
        fail "Failed to download docker-compose.yml, please check network connection"
    fi
}

# ──────────────────────────────────────────────────────────
# Merge new env vars into .env
# ──────────────────────────────────────────────────────────
merge_env() {
    header "5. Merging .env Settings"

    if [ ! -f ".env" ]; then
        warn ".env does not exist, downloading from upstream"
        if ! download "$REPO_URL/.env.example" .env; then
            rm -f .env
            fail "Failed to download .env.example, please check network connection"
        fi
        ok ".env created (using default values)"
        info "Please edit .env to set passwords and other custom values"
        return
    fi

    local tmp_example
    tmp_example=$(mktemp)
    if ! download "$REPO_URL/.env.example" "$tmp_example"; then
        rm -f "$tmp_example"
        warn "Failed to download .env.example, skipping env merge"
        return
    fi

    local added=0
    while IFS= read -r line; do
        [[ "$line" =~ ^[[:space:]]*#.*$ || -z "${line// /}" ]] && continue

        key="${line%%=*}"
        key="${key## }"; key="${key%% }"

        if grep -qE "^(export[[:space:]]+)?${key}=" .env 2>/dev/null; then
            :
        else
            echo "$line" >> .env
            added=$((added + 1))
            echo -e "  ${GREEN}➕${NC} ${key} added to .env"
        fi
    done < "$tmp_example"

    rm -f "$tmp_example"

    if [ "$added" -gt 0 ]; then
        ok "Merged ${added} new settings into .env"
    else
        ok ".env already contains all latest settings, no changes needed"
    fi
}

# ──────────────────────────────────────────────────────────
# Pull latest container image
# ──────────────────────────────────────────────────────────
pull_image() {
    header "6. Pulling Latest Docker Image"

    local old_id
    old_id=$(docker images ghcr.io/tryweb/ai-engkit:latest -q 2>/dev/null || true)
    if [ -n "$old_id" ]; then
        echo "  Current image ID: ${old_id:0:12}"
    else
        info "No AI-EngKit image found locally"
    fi

    echo "  Pulling ghcr.io/tryweb/ai-engkit:latest..."
    if docker compose pull 2>&1; then
        ok "Image updated to latest version"
    else
        ok "Image check completed"
    fi

    local new_id
    new_id=$(docker images ghcr.io/tryweb/ai-engkit:latest -q 2>/dev/null || true)
    if [ -n "$new_id" ] && [ "$new_id" != "$old_id" ] && [ -n "$old_id" ]; then
        echo "  New image ID: ${new_id:0:12}"
    fi
}

# ──────────────────────────────────────────────────────────
ensure_provider_state() {
    local state_dir="provider-state"
    local state_file="${state_dir}/provider-keys.json"
    mkdir -p "$state_dir"

    if [ -d "$state_file" ]; then
        mv "$state_file" "${state_file}.legacy.${TIMESTAMP}"
    fi
    if [ -e provider-keys.json ]; then
        if [ -f provider-keys.json ] && [ ! -e "$state_file" ]; then
            mv provider-keys.json "$state_file"
            ok "Migrated legacy provider-keys.json into ${state_dir}/"
        else
            mv provider-keys.json "provider-keys.json.legacy.${TIMESTAMP}"
            warn "Preserved legacy provider-keys.json as provider-keys.json.legacy.${TIMESTAMP}"
        fi
    fi
    if [ ! -f "$state_file" ]; then
        printf '{"providers":{}}\n' > "$state_file"
        ok "Provider registry initialized"
    fi
    chown 1000:1000 "$state_dir" "$state_file" 2>/dev/null || true
    chmod 700 "$state_dir"
    chmod 600 "$state_file"
}

# ──────────────────────────────────────────────────────────
# Prepare host volumes for admin container
# ──────────────────────────────────────────────────────────
prepare_volumes() {
    header "7. Preparing Volume Directories"

    mkdir -p ./backups
    chmod 777 ./backups
    ok "./backups ready"

    ensure_provider_state

    local ws_path
    ws_path=$(grep -E "^WORKSPACE_PATH=" .env 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$ws_path" ]; then
        ws_path=$(eval echo "$ws_path" 2>/dev/null || true)
        if [ ! -d "$ws_path" ]; then
            mkdir -p "$ws_path"
            ok "workspace directory created: ${ws_path}"
        fi
    fi
}

# ──────────────────────────────────────────────────────────
# Recreate containers
# ──────────────────────────────────────────────────────────
recreate_containers() {
    header "8. Recreating Containers"

    if [ -f ".env" ]; then
        local ws_path
        ws_path=$(grep -E "^WORKSPACE_PATH=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)
        if [ -n "$ws_path" ]; then
            ws_path=$(eval echo "$ws_path" 2>/dev/null || true)
            if [ ! -d "$ws_path" ]; then
                warn "WORKSPACE_PATH=${ws_path} directory does not exist, will create automatically"
                mkdir -p "$ws_path"
            fi
        fi
    fi

    echo "  Executing docker compose up -d --force-recreate..."
    docker compose up -d --force-recreate 2>&1 || {
        fail "Container startup failed, please check docker compose ps"
    }

    echo -n "  Waiting for service startup"
    for _ in {1..15}; do
        if docker compose ps --format json 2>/dev/null | grep -q '"Status":"running"' 2>/dev/null || \
           docker compose ps 2>/dev/null | grep -q "Up"; then
            break
        fi
        echo -n "."
        sleep 2
    done
    echo

    docker compose ps
    ok "Containers restarted"
}

# ──────────────────────────────────────────────────────────
# Clean up dangling images
# ──────────────────────────────────────────────────────────
cleanup_images() {
    header "9. Cleaning Up Old Images"

    local pruned
    pruned=$(docker image prune -f 2>&1 | grep -oE 'Total reclaimed space: .*' | sed 's/^Total reclaimed space: //' || true)
    if [ -n "$pruned" ]; then
        ok "Disk space freed: ${pruned}"
    else
        info "No cleanup needed"
    fi
}

# ──────────────────────────────────────────────────────────
# Show upgrade summary
# ──────────────────────────────────────────────────────────
show_info() {
    local host_ip=""
    if command -v ip &>/dev/null; then
        host_ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    elif command -v hostname &>/dev/null; then
        host_ip=$(hostname -I 2>/dev/null | awk '{print $1}' | grep -v '^fe80\|^::' | head -1)
    fi

    local chamber_port
    chamber_port=$(grep -E "^CHAMBER_PORT=" .env 2>/dev/null | cut -d= -f2 || true)
    chamber_port="${chamber_port:-8000}"

    echo
    echo -e "${BOLD}========================================${NC}"
    echo -e "${BOLD}  Upgrade Complete!${NC}"
    echo -e "${BOLD}========================================${NC}"
    echo
    if [ -n "$host_ip" ] && [[ ! "$host_ip" =~ ^127\. ]]; then
        echo -e "  ${CYAN}🌐${NC} Web UI: http://${host_ip}:${chamber_port}"
    else
        echo -e "  ${CYAN}🌐${NC} Web UI: http://localhost:${chamber_port}"
    fi
    echo
    echo -e "  ${YELLOW}ℹ${NC}  Backup directory: backup_${TIMESTAMP}/"
    echo "     (contains pre-upgrade docker-compose.yml and .env)"
    echo
    echo -e "  ${YELLOW}ℹ${NC}  To rollback:"
    echo "     docker compose down"
    echo "     cp backup_${TIMESTAMP}/docker-compose.yml docker-compose.yml"
    echo "     cp backup_${TIMESTAMP}/.env .env"
    echo "     docker compose up -d"
    echo
    echo -e "${BOLD}========================================${NC}"
}

# ──────────────────────────────────────────────────────────
# Self-update
# ──────────────────────────────────────────────────────────
self_update() {
    [ -n "${UPGRADE_SELF_UPDATED:-}" ] && return 0

    # Only self-update when running from a regular file on disk
    [ ! -f "$0" ] && return 0

    local tmp_file
    tmp_file=$(mktemp)

    if download "$REPO_URL/upgrade.sh" "$tmp_file" 2>/dev/null && [ -s "$tmp_file" ]; then
        if bash -n "$tmp_file" 2>/dev/null; then
            if ! cmp -s "$0" "$tmp_file"; then
                info "New version of upgrade.sh found, updating..."
                chmod +x "$tmp_file"
                mv "$tmp_file" "$0"
                ok "upgrade.sh updated to latest version"
                export UPGRADE_SELF_UPDATED=1
                exec bash "$0" "$@"
            fi
        fi
    fi
    rm -f "$tmp_file"
}

# ──────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────
verify_installed_environment() {
    if [ -f "docker-compose.yml" ] && [ -f ".env" ]; then
        return 0
    fi

    fail "AI-EngKit installation environment not found (missing docker-compose.yml or .env).

upgrade.sh is for existing installations only. For first-time installation, run install.sh instead:

  curl -fsSL https://raw.githubusercontent.com/tryweb/ai-engkit/main/install.sh | bash

If you have already installed via install.sh, please make sure you are running this script in the correct installation directory."
}

main() {
    cd "$(dirname "$0")"

    verify_installed_environment

    # Self-update before any operations (skipped when piped to shell)
    self_update "$@"

    echo
    echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║   AI-EngKit Upgrade Script           ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"

    check_system
    check_docker
    backup_files
    update_compose
    merge_env
    pull_image
    prepare_volumes
    recreate_containers
    cleanup_images
    show_info
}

main "$@"
