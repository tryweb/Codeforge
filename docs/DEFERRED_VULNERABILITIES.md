# Deferred Vulnerabilities Register

> 上游阻擋（upstream-blocked）弱點登錄檔。記錄因依賴上游重新打包而無法在
> 本專案直接修復、已以 `won't fix` dismiss 的 Grype code scanning alerts。
>
> **原則**：dismiss 不是「關閉」，是有記錄的決策。本 register 是這些決策的
> 追蹤機制，防止「dismiss 後失明」——上游修復、重新打包、或環境改變時，
> 條目必須被重新驗證與收斂。

## 政策

1. **只有「無法在本專案修復」的警報可以進 register**：
   - 可 pin 的依賴（Dockerfile `ARG`）→ 保持 open，由 `check-versions.sh` 追蹤，**不進 register**
   - OS 套件 → 由 `UPGRADE_PACKAGES` / apt upgrade 處理，**不進 register**
   - 僅限 bundled binary（套件內建 runtime，本專案無法替換）與永久環境事實
2. 每條記錄必須有 **解除條件（resolution condition）**：達到即收斂（resolved）
3. 收斂驗證掛在 release / check-updates 流程（見下方「收斂驗證」），
   CI 重建 image 後 Grype 重掃，修復的 CVE 會自動從掃描結果消失（alert 轉 `fixed`）
4. 已收斂條目從 Active 區段移到 Resolved 區段，保留 audit 軌跡

## Active

| Alert | CVE | 套件 | 版本 | 來源 | 嚴重度 | Dismiss 日期 | 解除條件 |
|---|---|---|---|---|---|---|---|
| 5694 | CVE-2026-56850 | node (bundled) | 24.16.0 | `@colbymchenry/codegraph-linux-x64` 1.5.0 | medium | 2026-08-05 | codegraph 重新打包（內建 node ≥ 24.18.1）；Dockerfile L134 unpinned，重建自動帶入 |
| 5651 | CVE-2026-58040 | node (bundled) | 24.16.0 | `@colbymchenry/codegraph-linux-x64` 1.5.0 | medium | 2026-08-05 | 同上 |
| 5666 | CVE-2026-58043 | node (bundled) | 24.16.0 | `@colbymchenry/codegraph-linux-x64` 1.5.0 | high | 2026-08-05 | 同上 |
| 5692 | CVE-2026-58039 | node (bundled) | 24.16.0 | `@colbymchenry/codegraph-linux-x64` 1.5.0 | low | 2026-08-05 | 同上 |
| 5693 | CVE-2026-56847 | node (bundled) | 24.16.0 | `@colbymchenry/codegraph-linux-x64` 1.5.0 | low | 2026-08-05 | 同上 |
| 5126 | CVE-2026-55999 | xserver-common | apt | ubuntu:24.04 | high | 2026-08-05 | 永久接受——headless container 無 X server 執行 |
| 5127 | CVE-2026-55999 | xvfb | apt | ubuntu:24.04 | high | 2026-08-05 | 永久接受——同上 |
| 5128 | CVE-2026-56000 | xserver-common | apt | ubuntu:24.04 | critical | 2026-08-05 | 永久接受——同上 |
| 5129 | CVE-2026-56000 | xvfb | apt | ubuntu:24.04 | critical | 2026-08-05 | 永久接受——同上 |

## Resolved

（無）

---

## 收斂驗證

release 與 check-updates 流程會執行以下檢查；本專案 CI 每次 build 皆會重跑
Grype 掃描，上游修復後 alert 會自動轉為 `fixed`：

```bash
# 對 Active 區段每條 alert 查目前狀態
gh api repos/tryweb/ai-engkit/code-scanning/alerts/<ALERT_NUMBER> --jq '.state'
# fixed   → 上游已修，掃描不再報 → 移入 Resolved 區段
# open    → 重新出現在掃描結果 → 重新評估（可能是誤判或需緩解）
# dismissed → 仍等上游，保持 Active
```

codegraph 類條目的直接驗證（不等 CI）：

```bash
~/.bun/install/global/node_modules/@colbymchenry/codegraph-linux-x64/node --version
# ≥ 24.18.1 → 已修復，收斂
```
