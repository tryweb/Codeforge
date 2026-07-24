# DooD 模式下的 bind mount 不生效：docker-compose.dev.yml 中的 `./src/admin:/opt/admin` 被 host 端空目錄覆蓋

## Context

ai-engkit 採用 DooD（Docker-out-of-Docker）模式，`docker compose` 命令經由 `/var/run/docker.sock` 轉發給 **host** 的 Docker daemon 執行。這代表所有 bind mount 的來源路徑都從 **host 的檔案系統**解析，而非 ai-engkit 容器內的檔案系統。

`docker-compose.dev.yml` 中 ai-admin 服務有以下 bind mount：

```yaml
volumes:
  - ./src/admin:/opt/admin          # 開發中即時更新
  - ./.env:/opt/ai-engkit/.env:rw   # 環境變數持久化
  - ./docker-compose.yml:/opt/ai-engkit/compose.yml:rw  # docker compose exec 用
```

當開發者在 ai-engkit 容器內修改 `src/admin/` 檔案時，這些變更**只存在於容器內**。Docker daemon 在 host 端找不到 `/home/devuser/workspace/ai-engkit/src/admin/`（因為 host 檔案系統沒有該路徑或該路徑內容不同），bind mount 會 fallback 到 overlay，最終容器看到的是**空目錄或舊的 image 內容**。

## 問題

執行 `docker compose -f docker-compose.dev.yml up -d ai-admin` 後，容器持續 restart：

```
ai-engkit-admin-dev  | error: Module not found "/opt/admin/server.ts"
```

即使 Dockerfile 中的 `COPY src/admin/ /opt/admin/` 已正確包含檔案，bind mount 仍會**覆蓋** `/opt/admin/`：

```bash
# 驗證：host 端 mount source 不存在或指向錯誤的目錄
$ docker run --rm -v /home/devuser/workspace/ai-engkit/src/admin:/check alpine ls -la /check/server.ts
# → server.ts 被視為**目錄**（不是檔案），表示 mount source 在 host 端是空的或不正確
```

同時，`.env` 和 `docker-compose.yml` 的 mount 也會失效，導致：
- auth 無法初始化（`/opt/ai-engkit/.env` 不存在）
- `docker compose exec ai-dev` 失敗（`/opt/ai-engkit/compose.yml` 不存在）
- devuser 無法存取 Docker socket（entrypoint 的 GID fix 沒執行）

## 解決方案

有兩種 workaround，依情境選擇：

### 方案 A：手動容器 + docker cp（開發期間測試用）

```bash
# 1. 用 sleep 啟動容器（繞過 bundle mount + entrypoint）
docker run -d --name ai-engkit-admin-dev \
  -p 8081:8080 \
  --network ai-engkit_default \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ai-engkit-ai-admin \
  /usr/bin/tini -- sleep 9999

# 2. 注入修改後的檔案
docker cp src/admin/. ai-engkit-admin-dev:/opt/admin/

# 3. 建立 auth 設定檔
docker exec ai-engkit-admin-dev sh -c \
  'sudo mkdir -p /opt/ai-engkit && echo "ADMIN_PASSWORD=admin" | sudo tee /opt/ai-engkit/.env > /dev/null'

# 4. 複製 compose 檔案（供 docker compose exec 使用）
docker cp docker-compose.dev.yml ai-engkit-admin-dev:/opt/ai-engkit/compose.yml

# 5. 啟動 server
docker exec -d -w /opt/admin ai-engkit-admin-dev bun /opt/admin/server.ts
```

### 方案 B：重建 image + 移除 bind mount（CI / 正式環境用）

修改 `docker-compose.dev.yml`，暫時移除無法正確解析的 bind mount，讓容器使用 image 內建的檔案：

```yaml
services:
  ai-admin:
    build:
      context: .
      dockerfile: Dockerfile
    # 移除 volumes: 中的 ./src/admin, ./.env, ./docker-compose.yml
    # 這些檔案需在 Dockerfile 中 COPY 進 image
```

然後 `docker compose build --no-cache ai-admin` 確保 image 包含最新程式碼。

## 為何有效

方案 A 的原理：
- `sleep 9999` 讓容器保持運行，**不觸發 entrypoint 初始化**（也就不會嘗試 fix docker GID）
- `docker cp` 直接寫入容器的 writable layer，不受 bind mount overlay 影響
- 手動建立 `/opt/ai-engkit/.env` 讓 auth 模組能讀到 `ADMIN_PASSWORD`
- Docker socket 透過 `ro` mount 保留，entrypoint 雖沒跑但 socket 本身可用（需 root 身分執行 `docker`）

方案 B 的原理：
- 移除 bind mount 後，容器使用 image 內建的 `/opt/admin/`，不受 host 端檔案系統影響
- `--no-cache` 確保 build 時重新 COPY 最新檔案進 image

## 副作用 / 取捨

- **方案 A** 的容器不是由 docker compose 管理，`docker compose logs` / `docker compose down` 無法控制它
  - 清理需手動：`docker rm -f ai-engkit-admin-dev`
- **方案 A** 的 bun process 以 root 身分執行（非 devuser），可能與正式環境行為略有差異
  - 若要模擬 devuser：加 `sudo -u devuser` 但需先 fix docker GID
- **方案 B** 會讓 dev 模式的 hot-reload（`--watch`）失效，因為檔案修改後不會同步進容器
  - 解決方式：每次修改後重新 build
- 此問題只在 DooD 模式發生。若 CI 的 Docker daemon 與 build context 在同一 host，bind mount 正常運作

## Evidence

```bash
# host 端 mount source 不存在或內容錯誤的證明
$ docker run --rm -v /home/devuser/workspace/ai-engkit/src/admin:/check alpine ls -la /check/server.ts
total 8
drwxr-xr-x    2 root     root          4096 Jul 24 07:39 .
drwxr-xr-x    2 root     root          4096 Jul 24 07:39 ..

# 本機檔案系統內容 vs host 端 mount 內容不同
$ ls -la /home/devuser/workspace/ai-engkit/src/admin/server.ts
-rw-rw-r-- 1 devuser devuser 5807 Jul 24 15:51 server.ts   # 容器內是檔案

# docker inspect 顯示 mount source 為 host 路徑
$ docker inspect ai-engkit-admin-dev --format '{{json .Mounts}}' | jq '.[] | select(.Destination=="/opt/admin") | {Source, Destination}'
{"Source": "/home/devuser/workspace/ai-engkit/src/admin", "Destination": "/opt/admin"}
```

## Related Files

- `docker-compose.dev.yml` — ai-admin volumes 定義
- `Dockerfile` line 258 — `COPY src/admin/ /opt/admin/`
- `entrypoint.d/03-fix-docker-gid.sh` — Docker socket GID 匹配腳本
- `src/admin/lib/docker.ts` — `execInAiDev` 使用 `/opt/ai-engkit/compose.yml`
- `src/admin/lib/env.ts` — `readEnvFile` 讀取 `/opt/ai-engkit/.env`
- `docs/knowledge/troubleshooting/dood-subproject-host-port-unreachable.md` — 相關 DooD 問題

## Tags

- docker
- DooD
- bind-mount
- volume
- admin-dashboard
- troubleshooting
- development-workflow
