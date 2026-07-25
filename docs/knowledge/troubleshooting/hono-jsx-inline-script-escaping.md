# Hono JSX Inline Script HTML Escaping

## Context

Hono JSX is used to render admin dashboard views. Inline JavaScript is embedded via `<script>{`...`}</script>` blocks inside JSX components.

## Problem

When a `<script>` tag contains a template literal as its child:

```tsx
<script>{`
  function foo() {
    const el = document.querySelector('.cls[data-key="' + key + '"]');
  }
`}</script>
```

Hono JSX **HTML-escapes** the string content, converting `'` to `&#39;` and `"` to `&quot;`. Browsers do **not** decode HTML entities inside `<script>` elements — the JavaScript parser sees the raw `&` character and throws `Unexpected token '&'`. The entire script block is silently discarded, leaving functions like `editVar()`, `saveVar()`, and `toggleMask()` undefined.

## Root Cause

JSX escapes text children by default to prevent XSS. For most HTML elements this is correct behavior. But `<script>` is a raw-text element — the HTML parser treats its content as JavaScript, not as HTML. Entities inside `<script>` remain encoded and are NOT decoded by the browser's HTML parser.

This is a well-known HTML specification behavior: `<script>` content is "raw text" and does not undergo entity decoding (unlike normal HTML elements).

## Solution

Use Hono's `html` tagged template from `hono/html` to bypass escaping:

```tsx
import { html } from "hono/html";

// Before (broken):
<script>{`
  function toggleMask(key) { ... }
`}</script>

// After (fixed):
<script>{html`
  function toggleMask(key) { ... }
`}</script>
```

The `html` tagged template returns a raw HTML `Safe` string that Hono JSX does not escape.

## Why It Works

`hono/html`'s `html` tagged template produces a `String` with a hidden symbol marker that tells Hono JSX "this is already safe, do not escape." The JavaScript content is rendered verbatim inside `<script>`, and the browser's JavaScript engine can parse it correctly.

## Side Effects / Tradeoffs

- `html` bypasses ALL escaping. If the script contains user-supplied values, ensure they are properly sanitized before inclusion.
- Alternative: move inline scripts to external `.js` files served via `serveStatic`. This avoids the issue entirely and enables CSP headers.
- Other Hono projects (`login.tsx`, `setup.tsx`) use `html` at the top level (`return html`<!doctype html>`) rather than inline, so they don't hit this issue.

## Detection

Symptoms in browser DevTools:
- Console error: `Uncaught SyntaxError: Unexpected token '&'`
- The script's JavaScript functions are undefined (`ReferenceError: editVar is not defined`)
- View page source — inside `<script>`, look for HTML entities like `&#39;` and `&quot;`

## Evidence

- Reproduced and fixed in `src/admin/views/env-editor.tsx`
- Before fix: console showed 2 errors (`Unexpected token '&'`, `editVar is not defined`)
- After fix: 0 console errors, all inline functions work

## Related Files

- `src/admin/views/env-editor.tsx` — was broken, now fixed with `html` tagged template
- `src/admin/views/login.tsx` — uses `html` at top level (not affected)
- `src/admin/views/setup.tsx` — uses `html` at top level (not affected)

## Tags

`hono` `jsx` `script` `html-escaping` `inline-script` `xss` `template-literal`
