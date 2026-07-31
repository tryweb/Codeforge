# Git Credential Helper Lost After Container Recreation

## Context

ai-engkit 的 git 認證設計:glab token 存於 `glab-config` volume
(`~/.config/glab-cli/config.yml`),git 透過 per-host credential helper
(`credential.<host>.helper=glab` → `git-credential-glab`)在 runtime 讀 token,
token 不落盤。

舊版實作由 admin UI 在 `glab auth login` 成功後,把 helper script
**runtime 部署**到 `~/.local/bin/git-credential-glab`(container 非 VOLUME 路徑)。

實例:172.16.1.61 (ai-engkit-61)。`glab auth status` 顯示 token 有效
(`Logged in to gitlab.tp.everplast.net as jade`),但 `git pull` 失敗。

## Problem

**症狀**(helper 遺失時 `git pull` 的錯誤,remote 為 HTTP/HTTPS):

```
git: 'credential-glab' is not a git command. See 'git --help'.
fatal: could not read Username for 'https://gitlab.tp.everplast.net': terminal prompts disabled
```

**根因鏈**:

1. `~/.local/bin/` **不在 Dockerfile 的 VOLUME 清單** → container recreate 時
   writable layer 重置,runtime 寫入的 helper script 消失
2. `upgrade.sh` 每次執行 `docker compose up -d --force-recreate` → **每次升級
   必然觸發**
3. `git-config` volume 保留 per-host `credential.<host>.helper=glab` 設定
   → git 呼叫已不存在的 helper
4. entrypoint `04-init-git-ssh.sh` 每次啟動無條件
   `git config --global credential.helper store`(與 f49b21a 移除 store 的設計
   衝突),但 store 檔為空 → 仍無 credential

**確認方法**:

```bash
# 1. 確認 ~/.local/bin 不在 volume 掛載清單(不在 = recreate 會重置)
docker inspect <container> --format '{{range .Mounts}}{{.Destination}}{{println}}{{end}}'
# 2. 確認 helper script 已消失
docker exec <container> ls -la ~/.local/bin/git-credential-glab
# 3. 確認 git 設定仍指向 helper(git-config volume 保留)
docker exec <container> git config --global --list
```

## Solution

- **長期**:helper script 改為 **baked 進 image** — 單一來源
  `scripts/git-credential-glab`,Dockerfile `COPY --chmod=0755` 到
  `~/.local/bin/`。image 層在 recreate 後依然存在。
- **entrypoint**:移除無條件 `credential.helper store`(git 認證完全由
  glab auth login 流程設定的 per-host helper 負責)。
- **緊急修復**(環境已壞、不想 rebuild image):glab token 有效,重新認證
  不必要;直接把 helper script 部署回 container 的 `~/.local/bin/` 即可
  (admin UI 重新 glab login 也會自動套用 git config)。
- **驗證耐久性**:連續兩次 `docker compose up -d --force-recreate` 後
  `git pull` 仍成功。

## Why It Works

- Docker overlay 語義:container create 時檔案來自 image 層;非 VOLUME 路徑的
  runtime 寫入在 recreate 後重置,BUILD 時寫入 image 的檔案則保留。
- glab token 在 `glab-config` volume,從未受影響 — 所以「重新認證」永遠不是
  這類問題的正解。

## Side Effects / Tradeoffs

- helper 更新需要 rebuild image(runtime 部署可免 build — 但那正是會壞的屬性)。
- entrypoint 不再保證任何 credential helper 存在;全新安裝尚未 glab login 時
  git 沒有 credential 來源(此時也不會有需要認證的 remote)。
- `~/.git-credentials` symlink 仍由 entrypoint 建立(空檔,無害)。

## Evidence

- ai-engkit-61 端到端:測試 image(= ghcr latest + helper COPY + 新 entrypoint)
  連續兩次 `--force-recreate` 後,helper 仍在(`devuser` owner)、
  `git config` 無 `store`、`git pull` → `Already up to date` (exit=0)。
- 修復前同機:`git pull` 出現 `git: 'credential-glab' is not a git command`。
- 本地:`bun test` 9 pass、`docker build --check` 無警告。

## Related Files

- `scripts/git-credential-glab` — helper script 單一來源(baked 進 image)
- `Dockerfile` — VOLUME 清單、helper COPY 位置(USER devuser 階段,owner 正確)
- `entrypoint.d/04-init-git-ssh.sh` — 不再寫 `credential.helper store`
- `src/admin/routes/glab-auth.ts` — `setupGlabCredentialHelper()`(只套 git config)
- `docs/knowledge/architecture/git-credential-glab-helper.md` — helper 機制設計

## Tags

`#git` `#credentials` `#glab` `#docker` `#volume` `#upgrade` `#credential-helper` `#troubleshooting`
