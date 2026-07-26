# Bind mount .env ownership mismatch 導致 Admin Env Save 失敗 (EACCES)

## Context

Production 部署使用 `docker-compose.yml` 啟動兩個容器（ai-dev, ai-admin）。
ai-admin 服務以 bind mount 將 host 端的 `.env` 掛入 container：

```yaml
volumes:
  - ./.env:/opt/ai-engkit/.env:rw
```

Container 內的 admin server（`bun run /opt/admin/server.ts`）透過 `writeFileSync()` 寫入
`/opt/ai-engkit/.env` 來儲存環境變數編輯。

## Problem

點擊 Admin UI → Environment → Edit → Save 後沒有反應（或提示 `Failed to save`）。

**錯誤訊息**（`docker logs ai-engkit-admin`）：

```
EACCES: permission denied, open '/opt/ai-engkit/.env'
    code: "EACCES"
```

原因鏈：

1. `upgrade.sh` 或 `install.sh` 以 **root** 身分建立 host 端的 `/opt/ai-engkit/.env`
2. `.env` 權限為 `root:root`（0644）— owner 可寫，其他人唯讀
3. Container 內的 admin server 以 **devuser**（UID 1000）執行
4. `writeFileSync()` 嘗試寫入 bind mount 的檔案 → 繼承 host 端的 root ownership → 權限不足

```
Host:  /opt/ai-engkit/.env   root:root  0644
         │
         │ (bind mount)
         ▼
Container: /opt/ai-engkit/.env   owner=UID 0  →  UID 1000 (devuser) can't write
                                       ↑
                          admin server runs as devuser (UID 1000)
```

## Solution

在 container 啟動時的 `00-fix-perms.sh` 加入自動修正：

```bash
fix_perms /opt/ai-engkit/.env
```

此函數會以 devuser 身分執行 `sudo chown 1000:1000 /opt/ai-engkit/.env`。
因為 `.env` 是 bind mount，變更會回寫到 host 端，一次性解決問題。

## Why It Works

- `00-fix-perms.sh` 在 container entrypoint 中執行，此時 `$(id -u)` = 1000 (devuser)
- `sudo chown 1000:1000 path` 將檔案 owner 改為 devuser， devuser 即可寫入
- `[ -e "$path" ]` 存在性檢查：ai-dev 容器沒有 mount `.env`，略過不影響
- bind mount 的特性：container 內的 ownership 變更會穿透到 host 檔案

## Side Effects / Tradeoffs

- ai-admin 容器透過 bind mount 修改 host 檔案系統（但這是期望行為）
- `fix_perms` 使用 `$(id -u)`，依賴 container 的預設 USER（目前 = devuser UID 1000）
  - 若日後 Dockerfile 的 USER 變更，需同步更新此處邏輯
- 其他不是 devuser 寫入的 bind mount 檔案不該加入此清單

## More Robust Approach

若需要完全不依賴 container 的 side effect，應在 host 端 `upgrade.sh` 的 `.env` merge
步驟後加入：

```bash
chown 1000:1000 /opt/ai-engkit/.env
```

但此作法要求 upgrade.sh 以 root 執行（已是現況），且 host 上 UID 1000 不一定要對應到
真實使用者（用於 bind mount 的數值 UID 配對即可）。

## Evidence

```bash
# 佐證：permission denied
$ docker logs ai-engkit-admin 2>&1 | grep EACCES
EACCES: permission denied, open '/opt/ai-engkit/.env'

# 佐證：修正前
$ ls -la /opt/ai-engkit/.env
-rw-r--r--  1 root  root  1626 Jul 26 12:11 .env

# 佐證：修正後 → Save 成功
$ curl -s -b <session> -X PUT http://localhost:8080/api/env/ADMIN_PORT \
  -H "Content-Type: application/json" -d '{"value":"8080"}'
{"ok":true}

$ ls -la /opt/ai-engkit/.env
-rw-r--r--  1 1000  1000  1627 Jul 26 12:20 .env
```

## Related Files

- `entrypoint.d/00-fix-perms.sh` — `fix_perms()` 函數實作
- `docker-compose.yml` line 40 — `./.env:/opt/ai-engkit/.env:rw` bind mount
- `src/admin/lib/env.ts` — `writeEnvFile()` 寫入 `/opt/ai-engkit/.env`
- `src/admin/routes/env.ts` — `PUT /api/env/:key` 處理儲存請求
- `src/admin/server.ts` — admin server entrypoint，以 devuser 執行
- `docs/knowledge/troubleshooting/dood-bindmount-admin-override.md` — 相關但不同的 DooD bind mount 問題

## Tags

- docker
- bind-mount
- permission
- EACCES
- admin-dashboard
- env-editor
- troubleshooting
- production
