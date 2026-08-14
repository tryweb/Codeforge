# Agent ↔ Center 通訊規格 v1

> 本文件由 `src/admin/agent/` 的程式碼實作逆向整理,作為 center 端實作對照。
> 對應來源:`protocol.ts`、`client.ts`、`auth.ts`、`heartbeat.ts`、`commands.ts`、`upgrade-event-bridge.ts`、`lib/upgrade.ts`、`lib/status.ts`、`lib/provider-keys.ts`。

## 1. Transport

- **協定**:WebSocket(`ws://` 或 `wss://`),agent **outbound** 主動連到 center。
- **URL 格式**:`wss://<center>/agent?token=<registration-token>[&ca=<base64url-PEM>]`
  - `token`:優先取 URL 內嵌(`extractTokenFromUrl`);URL 無 `?token=` 時改用環境變數 `CENTER_TOKEN`(`auth.ts:5` 的 `resolveRegistrationToken`)。
  - `ca`:center 端把 PEM 憑證 base64url 編碼放進 query param;agent 解出後作為 TLS CA(`protocol.ts:154` 的 `extractCaFromUrl`)。`ca` 參數會**保留在實際連線 URL 上**。
- 每則訊息 = 單一 JSON text frame。

## 2. Envelope(所有訊息共用的外殼)

```json
{
  "type": "<type>",
  "payload": { },
  "id": "agent-msg-7",
  "timestamp": "2026-08-10T00:00:00.000Z"
}
```

- `id`:agent 自產訊息為 `agent-msg-<seq>`(每 process 單調遞增);ack/result/error 會**回帶 command 的 id**。
- `timestamp`:ISO 8601 UTC(`new Date().toISOString()`)。

## 3. 訊息目錄

| type | 方向 | payload | 用途 |
|---|---|---|---|
| `hello` | A→C | `{agent_id, protocol_version: 1}` | 連線後第一個訊息 |
| `hello_ack` | C→A | `{}` | **必須**在第一個訊息回;否則 agent 斷線重連 |
| `heartbeat` | A→C | StatusReport(§5) | 每 60s 一次 |
| `ack` | A→C | `{status, message, started_at, finished_at, data?}` | command 執行結果(`data` 為可選欄位,目前僅 `gh.auth.start` 使用) |
| `error` | 雙向 | `{code, message}` | 錯誤;agent 對 malformed 用 |
| `command` | C→A | 見 §4 | center 下指令 |
| `result` | A→C | 見 §6 | query 的回應,`id` 對應 command id |
| `event` | A→C | `{name: "upgrade", data: UpgradeEvent}` | upgrade 進度事件 |

**Error codes(定義於 `protocol.ts:19-25`)**:`malformed_message`、`unknown_command`、`malformed_command`、`unsupported_version`、`auth_failed`

## 4. Commands(C→A)

| type | payload | 行為 |
|---|---|---|
| `upgrade` | `{}` | 先 ack `"upgrade starting"`,完成後再 ack 最終結果 |
| `reconfigure` | `{"env": {"KEY": "value"}}` | 寫入 env file 後重啟 ai-dev;先 ack `"reconfiguring"` 再 ack 結果 |
| `restart` | `{"service": "ai-dev" \| "ai-admin"}` | 重啟指定容器;先 ack `"restarting <svc>"` 再 ack 結果 |
| `status` | `{}` | 回 result:StatusReport |
| `env.get` | `{}` | 回 result:redacted env(§6) |
| `projects.list` | `{}` | 回 result:projects map(§6) |
| `providers.list` | `{}` | 回 result:providers meta(§6) |
| `providers.key.add` | `{"provider", "value", "note"?, "mode"?}` | 新增 key;第一把 key 會 apply + restart;先 ack `"adding provider key"` 再 ack 結果 |
| `providers.key.set-active` | `{"provider", "keyId", "mode"?}` | 切換 active key → apply → restart per mode;已 active 為 no-op;先 ack `"setting active provider key"` 再 ack 結果 |
| `providers.key.delete` | `{"provider", "keyId", "mode"?}` | 刪除 key;刪到 active 時 promote 下一把,或(最後一把)移除 auth entry + restart;先 ack `"deleting provider key"` 再 ack 結果 |
| `providers.key.update-note` | `{"provider", "keyId", "note"}` | 只更新 registry note,不 restart;先 ack `"updating provider key note"` 再 ack 結果 |
| `secrets.set` | `{"key", "value"}` — `key` ∈ `ADMIN_PASSWORD` \| `OPENCHAMBER_UI_PASSWORD` \| `OPENCODE_SERVER_PASSWORD` | 寫入 env;ack message 含 activation(`immediate` / `restart_required`),**不自行 restart**;單次 ack |
| `ssh.key.add` | `{"name"?, "keyType"? ("ed25519"\|"rsa"), "passphrase"?}` | 於 ai-dev home 產生 key pair 並註冊 ssh-agent;`name` 僅允許 `[A-Za-z0-9][A-Za-z0-9._-]*`;單次 ack |
| `ssh.key.delete` | `{"name"}` | 移除 key pair + 登出 ssh-agent;單次 ack |
| `ssh.key.list` | `{}` (query) | 回 result:`[{name, type, fingerprint}]` — 不含 key 內容 |
| `git.config.set` | `{"key", "value"}` | `git config --global` 寫入(如 `user.name`/`user.email`);單次 ack |
| `git.config.get` | `{}` (query) | 回 result:global config map — **刪除** `credential.*`/`url.*`,key-like 值經 `maskKey` 遮罩 |
| `gh.auth.start` | `{}` | 於 ai-dev 啟動 device flow;ack 的 `data` 帶 `{device_code, verification_uri}`;完成狀態靠 `status` query(`gh_auth`)輪詢 |
| `gh.auth.logout` | `{}` | `gh auth logout`;單次 ack |
| `glab.instance.add` | `{"hostname", "token"}` | `glab auth login --token` + 設定 git credential helper;token 只存在於 command payload;單次 ack |
| `glab.instance.remove` | `{"hostname"}` | `glab auth logout --hostname` + 移除 config entry;單次 ack |
| `glab.instances` | `{}` (query) | 回 result:`[{hostname, username, authenticated}]` — 不含 token |
| `projects.create` | `{"name", "gitInit"?, "gitRemote"?}` | clone(gitInit 在有 gitRemote 時預設 true)或 git init + 註冊 OpenChamber;先 ack `"creating project"` 再 ack 結果 |
| `projects.set-remote` | `{"name", "remote"}` | 設定/替換/移除 `origin`;fresh repo 會 shallow fetch + checkout;先 ack `"setting project remote"` 再 ack 結果 |
| `projects.enable` | `{"name"}` | 解除 disabled + 註冊 OpenChamber;單次 ack |
| `projects.disable` | `{"name"}` | 標記 disabled + 註銷 OpenChamber(失敗回滾);單次 ack |
| `projects.enable-feature` | `{"name", "feature"}` — `feature` ∈ `knowledge` \| `maintenance` \| `openspec` | 佈建 skill scaffold;單次 ack |
| `projects.sync` | `{"add"?: [name], "remove"?: [name]}` | 對帳 workspace ↔ OpenChamber 註冊;先 ack `"syncing projects"` 再 ack 結果 |

**重要語意**:
- 長操作 action(`upgrade`/`reconfigure`/`restart`、四個 provider-key command、`projects.create`/`projects.set-remote`/`projects.sync`)會對**同一個 command id 送兩次 ack** — 第一次 = accepted/starting(此時 `status` 恆為 `"success"`),第二次 = 最終 outcome。center 端必須處理「同 id 兩次 ack」。
- 快速 action(`secrets.set`/`ssh.key.*`/`git.config.set`/`gh.auth.*`/`glab.instance.*`/`projects.enable`/`projects.disable`/`projects.enable-feature`)只送**一次 ack**(最終 outcome)。
- `gh.auth.start` 的 ack payload 額外帶 `data: {device_code, verification_uri}` — 這是唯一的 ack `data` 使用場合,center 需把它顯示給操作者。

**Deferral**:upgrade 執行中(`isUpgradeRunning()`)時,收到的 command 進 FIFO queue;收到終態 upgrade 事件(任一 step 的 `failure`,或 `cleanup` 的 `success`,經 event bridge 轉發)後才 drain 執行。center 送出的 command 在 upgrade 期間不會立刻得到 ack。

**Restart mode**(`add`/`set-active`/`delete` 的 `mode` 欄位,省略時預設 `graceful`):
- `graceful`:先等所有 session idle(`waitForIdleSessions`,10 分鐘 deadline、15s 間隔),再 `docker stop`(SIGTERM)→ `compose up -d` recreate;最終 ack 標記 `"(graceful restart)"`。
- `force`:直接 `--force-recreate`;最終 ack 標記 `"(force restart)"`。
- graceful 等待逾時或 idle 檢查 API 失敗 → 自動 fallback 到 force,最終 ack 標記 `"(force restart after ...)"`。
- 最終 ack 的 message 一律載明**實際使用的** restart mode。

**Key-material containment**:機密物 — `providers.key.add` 的 key、`secrets.set` 的 value、`glab.instance.add` 的 token、`ssh.key.add` 的 passphrase、`gh.auth.start` 的 device code — 只存在於 command payload(device code 例外:同時存在於 `gh.auth.start` 的 ack `data`,這是傳遞給操作者所必需)。任何 `ack`/`result`/`event`/`error` 都**不得**包含明文機密;回應只帶 key id / key name,或經 `maskKey`(前4+後4字元)遮罩。log 與 error message 也不得含機密值。

**Key-command 失敗與 rollback 語意**:
- `key.add` 的第一把 key 會先檢查 auth store:該 provider 已存在 key 時回 failure(`"already holds a key in the ai-dev auth store; remove it before adding a registry key"`)且**不寫入 registry**。
- apply/restart 失敗自動 rollback:`add` 移除剛寫入的 key;`set-active` 還原為先前的 active key。`delete` 不回滾。
- `set-active` 目標已是 active key 時仍回兩次 ack,第二次 message 為 `"provider key <id> is already active"`(no-op 仍會回應)。

**Ack payload 範例**:

```json
{
  "type": "ack",
  "payload": {
    "status": "success",
    "message": "upgrade starting",
    "started_at": "2026-08-10T00:00:00.000Z",
    "finished_at": "2026-08-10T00:00:00.000Z"
  },
  "id": "<command id>",
  "timestamp": "2026-08-10T00:00:00.000Z"
}
```

## 5. Heartbeat payload(StatusReport)

```json
{
  "container_status": "running",
  "uptime_seconds": 42,
  "containers": {
    "ai-dev": {
      "status": "running",
      "uptime_seconds": 42,
      "version": "1.2.3"
    },
    "ai-admin": {
      "status": "running",
      "uptime_seconds": 8450,
      "version": "1.2.3"
    }
  },
  "versions": { "AI-EngKit": "1.2.3", "OpenCode": "", "OpenChamber": "", "Docker": "" },
  "gh_auth": "authenticated",
  "glab_auth": "not authenticated",
  "admin_version": "1.2.3",
  "admin_version_mismatch": false,
  "upgrade_state": "idle"
}
```

- `container_status` ∈ `running | stopped` — **legacy scalar**,等同 `containers["ai-dev"].status`,保留以相容舊 Center
- `uptime_seconds` — **legacy scalar**,等同 `containers["ai-dev"].uptime_seconds`,保留以相容舊 Center
- `containers` — 每個 AI-EngKit 實例的兩個容器:
  - `ai-dev` — 開發容器(container `ai-engkit` / `ai-engkit-dev`)
  - `ai-admin` — admin 容器(container `ai-engkit-admin` / `ai-engkit-admin-dev`),agent 本身所在容器
  - 每個容器: `status` ∈ `running | stopped`、`uptime_seconds`(null 代表無法取得)、`version`(容器內 `/opt/ai-engkit/VERSION`)
- `versions` 的值可能為空字串(對應指令執行失敗時)
- `upgrade_state` ∈ `idle | running | completed | failed`
- center **可以**對 heartbeat 回 ack/error(`id` 對應 heartbeat id);agent 僅記錄 `acked/errored` 並清除 pending(上限 100,超出丟最舊)— 不 ack 也不影響連線

## 6. Query result payloads

- **status** → StatusReport(同 §5)
- **env.get** →

```json
{
  "env": { "KEY": "value" },
  "redacted": ["ADMIN_PASSWORD", "CENTER_TOKEN"]
}
```

  `PASSWORD_KEYS`(`env-schema.ts` 中 `type: "password"` 的 key)值遮罩成 `••••••`;含 key material pattern(`sk-`、`ghp_`、`glpat-`、`AIza`、`token=`、`secret`)的字串值也遮罩(`maskKey`:前 4 字元 + `…` + 後 4 字元)

- **projects.list** →

```json
{
  "<project-name>": {
    "features": { "knowledge": true, "maintenance": false, "openspec": true },
    "remote": "git@github.com:org/repo.git",
    "disabled": false
  }
}
```

- **providers.list** →

```json
{
  "invalid": false,
  "error": null,
  "providers": [
    {
      "name": "opencode-go",
      "label": "Opencode Go",
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "https://api.example.com/v1",
      "hasApiKey": true,
      "keyManagement": true,
      "authStoreKeyPresent": true,
      "virtual": false,
      "registry": {
        "keyCount": 2,
        "activeKeyId": "k-abc123",
        "keys": [
          { "id": "k-abc123", "masked": "sk-a…wxyz", "note": "prod", "active": true }
        ]
      }
    }
  ]
}
```

  registry keys 一律 `maskKey`(前4…後4),原始值絕不出現

- **git.config.get** →

```json
{
  "user.name": "Alice",
  "user.email": "alice@example.com"
}
```

  `credential.*` 與 `url.*` 區段**整個刪除**;其餘值含 key material pattern(`sk-`、`ghp_`、`glpat-`、`AIza`、`token=`、`secret`)時以 `maskKey` 遮罩

- **glab.instances** →

```json
[
  { "hostname": "gitlab.com", "username": "alice", "authenticated": true }
]
```

  只讀 token 的存在性,任何情況下都不帶 token 值

- **ssh.key.list** →

```json
[
  { "name": "id_ed25519", "type": "Ed25519", "fingerprint": "256 SHA256:abc... comment (ED25519)" }
]
```

  不含 private key 或 public key 內容

## 7. Events(A→C)

```json
{
  "type": "event",
  "payload": {
    "name": "upgrade",
    "data": {
      "id": 1,
      "step": "backup",
      "status": "running",
      "message": "Backing up",
      "timestamp": "2026-08-10T00:00:00.000Z"
    }
  },
  "id": "agent-msg-9",
  "timestamp": "2026-08-10T00:00:00.000Z"
}
```

- `step` ∈ `digest_compare | backup | merge_env | recreate | poll_health | reconcile | cleanup`
- `status` ∈ `pending | running | success | failure`
- handshake 完成後才開始轉發;`cleanup` + `success|failure`(終態)轉發後即 detach,不再發送
- 無 buffering/replay:detach 期間的事件直接丟棄

## 8. 連線狀態機

1. socket open → 送 `hello`
2. 第一個訊息**必須**是 `hello_ack`,否則 close + 重連;`hello_ack` 後:heartbeat 啟動、event bridge attach、command 開始受理
3. malformed JSON → 回 `error{malformed_message, "Malformed JSON"}`(id 固定 `"unknown"`);若發生在 handshake 前則直接斷線
4. 收到未知 type → log 後忽略;重複 `hello_ack` → 忽略
5. 重連:指數 backoff **1s → 300s**(jitter 0.75–1.25×),收到 `hello_ack` 才 reset;socket close/error 或 handshake 前任何非 hello_ack 都觸發重連,無重試上限
6. agent 狀態:`disabled`(無 `CENTER_URL`)| `connected` | `disconnected`

## 9. 完整性缺口(center 開發前必須確認)

1. **`auth_failed`/`unsupported_version` 不會終止重連**:這兩個 error code 有定義但 agent 端**從不主動送**;若 center 對 `hello` 回 `error{auth_failed}`,agent 會把它當成「非 hello_ack → 斷線 → 無限重連」(backoff 到 300s 封頂後仍繼續)。center 若要表達永久拒絕,目前**沒有終止機制** — 建議 center 端設計成「直接 close 且不回應」或雙方新增明確的拒絕語意。
2. **heartbeat ack 是可選的**:center 不回 ack 不會有任何後果;agent 的 pending 集合理論上長到 100 就丟最舊。若 center 想用 heartbeat 做 liveness,得靠 socket-level timeout 而非 protocol。
3. **command 無 timeout 語意**:center 送 `upgrade`/`reconfigure`/`restart` 後,agent 一定回兩次 ack(先 starting 後最終),但**沒有「接受失敗」的 ack 區分** — 第一次 ack 的 `status` 恆為 `success`。
4. **reconfigure 的 value 未驗證**:任何字串都可寫入 env file(僅 `OPENCODE_PROVIDER` 在 HTTP 層驗 JSON,protocol 層無驗證)。
5. **無 message size / rate limit 規範**:agent 端對 frame 大小無限制(依 WebSocket 實作),center 需要自行定義。
