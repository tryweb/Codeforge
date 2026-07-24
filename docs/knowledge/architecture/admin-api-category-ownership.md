# Admin API 應回傳已分類資料，而非讓 View 自行分類

## Context

ai-admin (`src/admin/`) 是 ai-engkit 的管理後台，透過 Hono 提供 API + server-rendered JSX 頁面。Versions 頁面顯示 Dockerfile 中安裝的所有工具版本。先前 `/api/versions` 回傳 flat `Record<string, string>`（如 `{"OpenCode": "1.18.4", "Bun": "1.3.14"}`），View 自行決定渲染方式。

在 redesign-versions-page 任務中，需要將 17 個工具分成 4 個分類（Core、CLI、MCP、Plugin）以卡片方式呈現。

## 問題

有兩個設計選項：

| 選項 | API 回傳 | View 職責 |
|------|----------|-----------|
| A: View 分類 | 維持 flat map | View 內寫死每工具的分類歸屬 |
| B: API 分類 | 回傳 `{core: {...}, cli: {...}, ...}` | View 只管依序渲染每分類 |

選項 A 的問題：
- View 需要知道每工具的分類歸屬（分類邏輯重複）
- 新增工具需要同時改 API（加 version command）和 View（加分類映射）
- 分類順序寫死在 View 中，無法被其他 consumer（如 CLI 工具、test script）使用
- API 消費者無法得知工具的分類結構

## 解決方案

採用選項 B：讓 `/api/versions` 直接回傳 grouped object。

```typescript
// API response shape
{
  "core":   { "Bun": "1.3.14", "Docker": "29.6.2", ... },
  "cli":    { "OpenCode": "1.18.4", "gh": "2.96.0", ... },
  "mcp":    { "Playwright MCP": "0.0.78" },
  "plugin": { "superpowers": "6.2.0", ... }
}
```

實作方式：

```typescript
const categoryCommands: Record<string, Record<string, string>> = {
  core: {
    "Bun": "bun --version 2>/dev/null || echo 'unavailable'",
    // ...
  },
  cli: { /* ... */ },
  mcp: { /* ... */ },
  plugin: { /* ... */ },
};

// 每分類平行執行 version command，分組回傳
const result: Record<string, Record<string, string>> = {};
for (const [category, commands] of Object.entries(categoryCommands)) {
  const entries = Object.entries(commands);
  const settled = await Promise.allSettled(
    entries.map(([name, cmd]) => getVersion(name, cmd).then(v => ({ name, version: v }))),
  );
  // ... collect into result[category]
}
return c.json(result);
```

## 為何有效

- **單一真理源**：工具的分類歸屬只在 API 層定義一次，View 和 test script 都消費同一結構
- **新增工具只需改一處**：在 `categoryCommands` 對應分類下加 entry 即可，View 自動渲染
- **API consumer 中立**：任何 consumer（View、test script、CLI）都能直接使用分類資訊
- **分類順序由 API 決定**：View 透過 `categoryOrder` array 控制渲染順序，與資料定義分離

## 副作用 / 取捨

- **[Breaking API]** Flat map 消費者需更新：`versionsData["OpenCode"]` 變成 `versionsData.cli["OpenCode"]`
  - 緩解：ai-admin 的 `/api/versions` 只有內部 UI 使用
- **API response 體積略增**：多了 4 個分組 key，但整體差異可忽略
- **空分類仍會回傳**：如 MCP 只有 1 工具，仍以獨立分類呈現（符合設計預期）

## Evidence

- 改動後 17 工具正確分布在 4 分類：core(4) + cli(10) + mcp(1) + plugin(2)
- View 透過 `categoryOrder` 依序渲染 Core → CLI → MCP → Plugin 四張卡片
- `test/test-admin-ui.sh` 直接驗證 `has("core") && has("cli") && has("mcp") && has("plugin")`
- 實際部署驗證：`curl /api/versions | jq 'keys'` 回傳 `["cli", "core", "mcp", "plugin"]`

## Related Files

- `src/admin/routes/versions.ts` — `categoryCommands` 定義 + 分組執行邏輯
- `src/admin/views/versions.tsx` — `VersionsPage` 接受 `Record<string, Record<string, string>>`
- `test/test-admin-ui.sh` line 91-101 — 分組結構驗證測試
- `openspec/changes/redesign-versions-page/design.md` — D1: API response structure 設計決策
- `openspec/changes/redesign-versions-page/specs/categorized-versions/spec.md` — Spec

## Tags

- api-design
- hono
- admin-dashboard
- version-management
- categorization
- breaking-change
