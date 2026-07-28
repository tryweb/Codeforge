# Mobile Nav Toggle No-Op — Duplicate Script Load Registers Duplicate Listeners

## Context

ai-admin 的 mobile hamburger nav(admin-mobile-support change)。`layout.tsx` 的 `<body>` 尾端有兩個相同的 `<script src="/static/app.js" />` 標籤(pre-existing bug)。app.js 的 IIFE 對 `#nav-toggle` 註冊 click listener,切換 `.app-layout` 上的 `nav-open` class。

## Problem

Hamburger 按鈕可見、click 有觸發、listener 確實有註冊——但 sidebar 永遠打不開。

用 Playwright 插桩 `EventTarget.prototype.addEventListener` 才發現:同一個 element 上註冊了**兩個相同的 listener**(因為 script 載入兩次,IIFE 每次產生新的 function object,不會被瀏覽器 dedup)。每次 click,`classList.toggle("nav-open")` 被呼叫兩次:第一個 listener 加 class,第二個立刻移除。同個 event loop tick 內完成,肉眼看起來就是「完全沒反應」。

這個 bug 的隱蔽性在於:單獨檢查每一環都「正確」——element 存在、listener 存在、click 觸發、toggle 被呼叫。只有數 toggle 呼叫次數才會發現是偶數次(抵銷)。

## Solution

1. 移除 `layout.tsx` 重複的 `<script src="/static/app.js" />` 標籤
2. app.js 加 idempotency guard,防止未來任何重複載入再犯:

```javascript
if (!window.__navUiInit) {
  window.__navUiInit = true;
  var navToggle = document.getElementById("nav-toggle");
  // ... addEventListener ...
}
```

## Why It Works

瀏覽器對 `addEventListener` 的 dedup 只適用於「相同 function 參照 + 相同 capture flag」。IIFE 每次執行都產生新的 closure,所以重複載入 = 重複註冊。兩個 listener 對同一個 toggle 各叫一次 = 回到原狀。Guard 用全域 flag 確保第二次載入整段跳過。

## Side Effects / Tradeoffs

- `window.__navUiInit` 是全域變數,理論上可能被其他 script 誤用——但 admin 是封閉的 SSR 頁面,風險可忽略
- Guard 讓 hot-reload 場景(開發時手動注入 script)也不會產生重複 listener

## Evidence

- Playwright 插桩:`#nav-toggle` 上註冊 2 個 listener;`toggle("nav-open")` 每次 click 被叫 2 次
- 修復後:每次 click 恰好 1 次 toggle,nav 正常開關
- 回歸測試(注入第二次 app.js 模擬舊 bug 場景):9/9 pass,guard 阻止重複註冊

## Related Files

- `src/admin/views/layout.tsx` — 移除重複 script tag
- `src/admin/static/app.js` — `__navUiInit` guard
- `openspec/changes/admin-mobile-support/` — 原始 change

## Tags

- admin
- mobile
- javascript
- event-listener
- duplicate-script
- debugging
