# test/run-tests.sh 的 container name 偵測與 dev compose 不一致

## Context

執行整合測試時，container name 若與 `docker-compose.dev.yml` 不符，會產生誤導性失敗。有兩種獨立觸發路徑：手動執行不帶參數（預設值不符），以及 check-updates skill 的自動偵測（抓到 admin container）。

## Problem

**路徑 1 — 預設值不符：** `test/run-tests.sh` 第 10 行預設 `CONTAINER="${1:-ai-dev}"`，但 `docker-compose.dev.yml` 定義 `container_name: ai-engkit-dev`。直接執行 `bash test/run-tests.sh` 報錯：

```
OCI runtime exec failed: exec failed: unable to start container process: exec: "./test/run-tests.sh": stat ./test/run-tests.sh: no such file or directory
```

**路徑 2 — 自動偵測抓錯 container：** `.opencode/skills/check-updates/SKILL.md` 第 115 行用 `docker compose -f docker-compose.dev.yml ps --format '{{.Name}}' | head -1` 自動偵測 container name。`docker compose ps` 依 compose 定義順序列出，第一個是 `ai-engkit-admin-dev`（admin service）。測試在 admin container 上執行**不會**報 OCI error，而是 OpenChamber 測試大量失敗（假失敗），容易被誤判為真實回歸。

## Solution

一律明確傳入 `ai-engkit-dev`：

```bash
bash test/run-tests.sh ai-engkit-dev
```

自動化腳本（如 check-updates skill）不得用 `docker compose ps | head -1` 推斷 container，應寫死 dev service 的 container name。

## Why It Works

測試腳本用 `docker exec "$CONTAINER"` 操作目標 container。OpenChamber 測試需要 port 3000（`ai-engkit-dev` 持有），在 admin container 上執行因缺少對應環境而假失敗；預設值 `ai-dev` 則直接找不到 container。兩種情況都只能靠明確傳入正確名稱解決。

## Side Effects / Tradeoffs

- 若使用 `docker-compose.yml`（正式部署），container name 可能不同，需要對應調整。

## Evidence

- `bash test/run-tests.sh`（無參數）→ OCI exec 錯誤
- check-updates 自動偵測到 `ai-engkit-admin-dev` → 140 PASS / 8 FAIL（假失敗）
- 重跑 `./test/run-tests.sh ai-engkit-dev` → 151 PASS / 0 FAIL（Docker 29.7.1 bump 驗證）

## Related Files

- `test/run-tests.sh` (line 10: `CONTAINER="${1:-ai-dev}"`)
- `docker-compose.dev.yml` (line 9: `container_name: ai-engkit-dev`)
- `.opencode/skills/check-updates/SKILL.md` (line 115: `docker compose ps | head -1` 偵測)

## Tags

- testing
- docker-compose
- dev-environment
- check-updates
