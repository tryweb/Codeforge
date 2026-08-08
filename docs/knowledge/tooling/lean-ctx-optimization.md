# lean-ctx Configuration Optimization for ai-engkit

## Context

ai-engkit 在容器映像建置時安裝 lean-ctx(`Dockerfile` L134)並在 entrypoint 註冊 MCP 伺服器(`entrypoint.d/02-init-config.sh` L152-154)。`docker-compose.yml` 透過 `lean-ctx-data`、`lean-ctx-state` 兩個 named volume 持久化資料,並依 XDG Base Directory 規範分目錄。

> **Current state (lean-ctx 3.9.18):** 下列 Solution A、B、C 已套用到 repo。映像會產生 `config.toml`,entrypoint 會安裝 shell hook 與 OpenCode integration,測試則驗證 MCP 連線及 non-interactive shell 環境。原 Problem 內容保留為設計沿革。

實際部署後,`lean-ctx doctor` 27/32 通過 — 整體骨架完整(XDG layout pin、build-time 安裝、MCP 設定、legacy 遷移邏輯都到位),但仍有 4 個明顯的優化缺口,以及一個會誤導排查方向的 false-positive。

## Problem

### 1. 完全使用 lean-ctx 預設值 — 沒有 `~/.config/lean-ctx/config.toml`

**Resolved:** `Dockerfile` 現已 bake `config.toml`,並在 3.9.18 升級時明確設定 `cognitive_mode = "full"`。

`lean-ctx doctor` 顯示:

```
✓ config.toml  not found, using defaults  (expected at ~/.config/lean-ctx/config.toml)
```

這代表以下設定全部用出廠預設:

| 設定 | 出廠預設 | ai-engkit 場景的影響 |
|---|---|---|
| `permission_inheritance` | `off` | `ctx_shell` 不鏡像 `opencode.json` 的 `permission` block;`Sisyphus-Junior` 等 agent 已設的 `*.env = ask` 等規則對 MCP 工具無效 |
| `compression_level` | `lite` | 60-90% token savings 潛力未完全釋放 |
| `shell_allowlist_extra` | `[]` | 常用工具(`gh`、`glab`、`docker compose`、`pw-mcp`、`marksman`)雖有預設 allowlist,但若升級 lean-ctx 後預設改變會失效 |
| `graph_index_max_files` | `0`(無限) | 容器內大型 monorepo 會把整個 workspace 索引進去,啟動延遲增加 |

### 2. Shell hook 與 SKILL.md 未安裝

**Resolved:** entrypoint 目前會執行 lean-ctx setup / OpenCode agent initialization;`test/run-tests.sh` 也會驗證 shell hook、agent aliases 與 MCP 連線。

`doctor` 報:

```
✗ Shell aliases  no "lean-ctx" in ~/.zshrc, ~/.bashrc
✗ SKILL.md       not installed
```

互動 shell 跑 `git status` 等指令不會被 lean-ctx 壓縮;`/help` 沒有 lean-ctx 章節。

### 3. 需驗證的是 `sudo -E` / shell 執行路徑,不是 Docker `ENV` 繼承

**Resolved and verified:** `Dockerfile` 已設定 `BASH_ENV` / `CLAUDE_ENV_FILE`,`test/run-tests.sh` 會驗證 runtime 值及 non-interactive bash 能解析 `env.sh`。

`Dockerfile` L137-138 已宣告:

```dockerfile
ENV BASH_ENV="/home/${USERNAME}/.config/lean-ctx/env.sh"
ENV CLAUDE_ENV_FILE="/home/${USERNAME}/.config/lean-ctx/env.sh"
```

這兩個變數是 **容器 runtime 環境變數** ,不是只給互動 shell 用。Bash 的實際語義剛好相反:`BASH_ENV` 是給 **non-interactive bash**(例如 `bash -c 'cmd'`) 讀取,互動 shell 讀的是 `~/.bashrc`,login shell 讀的是 `~/.bash_profile` / `/etc/profile`。

因此真正要驗證的不是「Dockerfile `ENV` 不會被子 process 繼承」,而是下面兩件事:

1. `entrypoint.sh` 末端的 `sudo -E -u devuser -- env PATH="$PATH" "$@"` 是否在目前 sudoers policy 下保留 `BASH_ENV` / `CLAUDE_ENV_FILE`
2. OpenCode / agent shell tool 是否經過 `bash -c` 啟動;若直接 `execve()` 非 bash 程式,即使環境變數存在,`BASH_ENV` 也不會被讀取

換句話說,這裡的風險是 **runtime 執行鏈** 與 **sudo preserve-env 行為** ,不是 Docker `ENV` 本身失效。

### 4. `lean-ctx doctor` 對 OpenCode MCP 設定報 false-positive

**Requires revalidation on 3.9.18:** 不應由舊版 `doctor` 計數推論目前狀態;以 `opencode mcp list` 的 connected 結果與 MCP `tools/list` 為 runtime gate。

```
✗ OpenCode  ✗ OpenCode MCP  drift (~/.config/opencode/opencode.json)
```

讀 `~/.config/opencode/opencode.json` L36-42,實際設定是:

```json
"mcp": {
  "lean-ctx": { "type": "local", "command": ["lean-ctx"], "enabled": true }
}
```

`doctor` 用舊 MCP spec key `mcpServers` 檢查 OpenCode 設定,但 [OpenCode 官方文件](https://opencode.ai/docs/mcp-servers/) 明確使用 `mcp`(**新格式**)。`opencode mcp list` 才能確認實際連線狀態。

## Solution

以下方案均已落實;程式片段保留作為設計理由與維護參考。

### A. 把 `config.toml` bake 進容器映像

在 `Dockerfile` lean-ctx 安裝區段後追加(`Dockerfile` 約 L134):

```dockerfile
RUN mkdir -p /home/${USERNAME}/.config/lean-ctx && \
    cat > /home/${USERNAME}/.config/lean-ctx/config.toml <<'EOF'
# lean-ctx ai-engkit tuning — overrides conservative defaults
permission_inheritance = "on"     # mirror opencode.json permission rules
compression_level     = "standard" # unlock the 60-90% savings tier
shell_allowlist_extra = [
  "gh", "glab",
  "docker", "docker-compose", "docker compose",
  "pw-mcp", "bun", "marksman", "lancedb-opencode-pro",
]
graph_index_max_files = 5000       # bound monorepo scans
savings_footer        = "auto"     # show in CLI, suppress in agent context
EOF
```

### B. Entry-time 安裝 shell hook,並補跑 OpenCode agent 初始化

在 `entrypoint.d/02-init-config.sh` lean-ctx MCP 區塊(L152)之後追加:

```bash
# --- lean-ctx shell hook + OpenCode agent init ---
if command -v lean-ctx &>/dev/null; then
  # setup 會安裝 shell hook / aliases,且支援非互動冪等執行
  if ! grep -qF 'lean-ctx shell hook' "$HOME/.bashrc" 2>/dev/null; then
    lean-ctx setup --non-interactive --yes >/dev/null 2>&1 || true
  fi
  # 嘗試補齊 OpenCode rules / integration（目前版本未必會產生 SKILL.md）
  if [ ! -f "$HOME/.config/opencode/skills/lean-ctx/SKILL.md" ]; then
    lean-ctx init --agent opencode >/dev/null 2>&1 || true
  fi
fi
```

### C. 驗證 `BASH_ENV` 真正生效點,不要把 `export` 當成修復

`Dockerfile` 內的:

```dockerfile
ENV BASH_ENV="/home/${USERNAME}/.config/lean-ctx/env.sh"
ENV CLAUDE_ENV_FILE="/home/${USERNAME}/.config/lean-ctx/env.sh"
```

已足以把變數放進容器 runtime environment,因此 **不需要** 在 `entrypoint.sh` 再做一次 `export`。比較實際的做法是把驗證收斂到兩個檢查:

```bash
env | grep -E '^(BASH_ENV|CLAUDE_ENV_FILE)='
bash -c 'printf "BASH_ENV=%s\\n" "$BASH_ENV"; test -f "$BASH_ENV" && echo env-sh-present'
```

若未來真的觀察到 `sudo -E` 後變數消失,再把補強放在 `entrypoint.sh` 或 sudoers `env_keep` 設定中;在目前證據下,直接新增 `export` 只是重複宣告,無法證明能修掉任何已知問題。

### D. 忽略 OpenCode MCP drift 假警報

升級 lean-ctx 後若 upstream 仍未修正 `mcpServers` 檢查邏輯,在 `lean-ctx setup --fix` 之外用以下方式驗證真實狀態:

```bash
opencode mcp list                # 確認 lean-ctx 為 connected
lean-ctx status --json | jq '.mcp'   # 確認 MCP 註冊成功
```

## Controlled Upgrade Verification

升級 lean-ctx pin 後依序執行:

```bash
docker compose -f docker-compose.dev.yml build ai-dev
docker compose -f docker-compose.dev.yml up -d
CONTAINER=$(docker compose -f docker-compose.dev.yml ps --format '{{.Name}}' | head -1)
./test/run-tests.sh "$CONTAINER"
```

驗收條件:

1. `lean-ctx --version` 回報 Dockerfile pin 的版本。
2. baked `config.toml` 通過 `lean-ctx config validate`,且明確包含預期的 `cognitive_mode`。
3. `opencode mcp list` 顯示 lean-ctx connected,核心工具 `ctx_read`、`ctx_shell`、`ctx_compose` 存在;不要斷言固定工具總數,因為工具可見性受 profile 影響。
4. `lean-ctx doctor` 不新增 failure,並以 execution agent / read-only agent 各跑一個代表性 workflow,確認沒有可重現的 permission regression 或 hang。
5. CPU、RAM、latency 與 volume 使用量只以前後固定 workload 的實測值評估;upstream release notes 未提供可直接套用的資源增幅。

生產部署前先備份 `lean-ctx-data`、`lean-ctx-state` volumes。若 MCP 斷線、核心工具缺失、persisted state 無法讀取或發生可重現的 permission regression,恢復舊 image 與升級前 volume snapshot。`cognitive_mode = "off"` 僅用於隔離 cognitive 功能問題,不視為完整 rollback。

## Why It Works

- **`permission_inheritance = "on"`** — 啟用 lean-ctx 的 IDE permission inheritance。現行 agent 權限位於 `~/.omo/omo.jsonc`,`opencode.json` 不含 inline agent section;不可假設舊文件中的 `*.env = ask` 規則仍存在,實際 allow/deny 行為須由 runtime smoke test 驗證。
- **`compression_level = "standard"`** — 啟用平衡壓縮模式。實際 token savings 與 CPU/RAM/latency 影響依 workload 而定,升級時應以前後固定 workload 量測,不沿用舊版百分比作為驗收值。
- **`graph_index_max_files = 5000`** — 為 ai-engkit 常見的 monorepo 提供上限,避免初次啟動時整個 `~/workspace` 被索引。
- **shell hook + SKILL.md** — 互動 shell 與 `/help` 都能享受 lean-ctx 能力。實測在 lean-ctx 3.8.11 中,`setup --non-interactive --yes` 比單獨 `init --global` 更完整,會補 `~/.bashrc` / `~/.bashenv`;`init --agent opencode` 仍值得保留來更新 OpenCode rules,但目前版本不一定會產生 `SKILL.md`。
- **`BASH_ENV` 驗證** — `ENV BASH_ENV=...` 已能提供 non-interactive bash 所需的環境變數;真正該確認的是 `sudo -E` 後變數是否仍在、以及工具是否確實經過 bash 啟動。

## Side Effects / Tradeoffs

- **`permission_inheritance = "on"`** 的實際效果依 host IDE 與當前權限來源而定。AI-EngKit 的 OMO 權限不在 `opencode.json` inline agent section;升級後應實測一個 execution agent 與一個 read-only agent,而非由 config 靜態推論。
- **shell hook 寫進 `~/.bashrc`** 會在每次容器啟動時重複檢查;`~/.bashrc` 已被 `opencode-config` volume 持久化,容器升級後不會丟失,但 lean-ctx 升級後可能需要重新 `setup`。
- **OpenCode MCP drift 假警報** 是 lean-ctx upstream 的相容性問題,可能在未來版本修復;在那之前,debug 時要認得 `mcpServers` 檢查對 OpenCode 不適用。
- **`config.toml` 是映像 baked** — `docker compose build --no-cache` 後會重生,任何手動修改都會丟失;若需要 runtime 修改,用 `lean-ctx config set <key> <value>`(會自動偵測已有 config.toml)。
- **`init --agent opencode` 對 `SKILL.md` 的效果受版本/上下文影響** — 在目前驗證的 lean-ctx 3.8.11 + 空 workspace volume 啟動路徑下,它會更新 OpenCode rules,但 `doctor` 仍可能回報 `SKILL.md not installed`。
- **`BASH_ENV` 問題要靠驗證而非重複 export** — 若 bash tool 是走 `bash -c`,現有 Dockerfile `ENV` 即應生效;若 future regression 出在 `sudo -E` / `env_keep`,需要修的是 preserve policy,不是再宣告一次同值。

## Evidence

- `lean-ctx doctor` 顯示 27/32 通過,5 個 issues 對應本文 4 個 Problem（pre-fix 3.8.x 歷史結果;3.9.18 必須重新執行）
- `lean-ctx doctor integrations` 顯示 OpenCode `OpenCode MCP drift`
- 實際 MCP 設定檔: `~/.config/opencode/opencode.json` L36-42
- Dockerfile lean-ctx 區段: L134(install)、L137-138(`ENV BASH_ENV`、`ENV CLAUDE_ENV_FILE`)、L231(`/home/.../.local/share/lean-ctx` in VOLUME)
- docker-compose.yml volume 宣告: L10-11(`lean-ctx-data`、`lean-ctx-state`)
- entrypoint.d/02-init-config.sh: L110-117(legacy 遷移)、L152-154(MCP 設定)
- 參考文件:
  - https://leanctx.com/docs/configuration/ — config.toml 完整參考
  - https://leanctx.com/docs/getting-started/ — Docker 安裝步驟
  - https://leanctx.com/docs/troubleshooting/ — MCP 整合健康檢查
  - https://opencode.ai/docs/mcp-servers/ — OpenCode `mcp` 格式

## Related Files

- `Dockerfile` (L134, L137-138, L231, L259-260)
- `entrypoint.d/02-init-config.sh` (L110-117, L152-154, lean-ctx setup / agent init)
- `test/run-tests.sh` (LeanCTX section — config、shell hook、MCP 與 doctor 的 live verification)
- `docker-compose.yml` (L10-11)
- `~/.config/opencode/opencode.json` (L36-42 — 對應宿主端)
- `docs/knowledge/tooling/lean-ctx-xdg-layout.md` — 互補:佈局 pin 機制
- `docs/TOOLING.md` — MCP 與知識工具章節
- `docs/ARCHITECTURE.md` — lean-ctx 架構章節

## Tags

- lean-ctx
- configuration
- opencode
- docker
- mcp
- shell-hook
- permission-inheritance
- optimization
