# Hono `html` Tagged Template Escapes JSON in Inline `<script>`

## Context

ai-admin uses Hono's `html` tagged template (`import { html } from "hono/html"`) to inline JavaScript in server-rendered JSX pages. This pattern is used extensively for passing server-side data to client-side scripts without a separate API call.

```tsx
<script>{html`
  var data = ${JSON.stringify(someObject)};
  function handler() { /* uses data */ }
`}</script>
```

## Problem

The `html` tagged template HTML-escapes all interpolated values (`${...}`). When `JSON.stringify(someObject)` produces a string containing `"` characters, they are emitted as `&quot;` HTML entities. This breaks JavaScript syntax:

```html
<!-- Rendered HTML (broken) -->
<script>
  var data = [{&quot;key&quot;:&quot;ADMIN_PASSWORD&quot;,&quot;hasValue&quot;:true}];
  function handler() { }
</script>
```

`&quot;` is not valid JavaScript — the browser throws a `SyntaxError` when parsing the script block. As a result, **all functions defined in that `<script>` block are never registered**, and any `onclick` handlers referencing them silently fail.

### Detection

The failure is silent in production: inline `onclick="handler()"` attributes resolve to `undefined` functions and produce no visible error. The developer notices that buttons do nothing when clicked. Checking `typeof handler` in the browser console returns `"undefined"`.

## Solution

Use `raw()` from `hono/html` to mark the JSON string as pre-escaped (raw), preventing the `html` tag from double-escaping it:

```tsx
import { html, raw } from "hono/html";

<script>{html`
  var data = ${raw(JSON.stringify(someObject))};
  function handler() { /* uses data */ }
`}</script>
```

Rendered output (correct):

```html
<script>
  var data = [{"key":"ADMIN_PASSWORD","hasValue":true}];
  function handler() { }
</script>
```

## Why It Works

- `html` tagged template only escapes interpolated values (`${...}`), not literal template text
- `raw()` wraps the string in an `HtmlEscapedString` object with `isEscaped: true`
- The `html` tag's runtime skips escaping for values where `isEscaped` is true
- Function definitions and other literal JavaScript in the template are unaffected because they are not in `${...}` interpolation blocks

## Side Effects / Tradeoffs

- `JSON.stringify` output must be safe for inline `<script>` (no `</script>` in strings) — this is guaranteed by JSON encoding
- Only applies to `html` tagged templates; Hono JSX (`{expression}` in JSX) has different escaping rules
- The `env-editor.tsx` file did not hit this bug because it passes values through `onclick` attribute arguments (JSX-escaped, not `html`-escaped), not through inline JSON in a `<script>` block

## Evidence

```bash
# Before fix: functions are undefined
> typeof showSecretValue
"undefined"

# Rendered HTML shows &quot; entities
$ grep "secretsMeta" page.html
var secretsMeta = [{&quot;key&quot;:&quot;ADMIN_PASSWORD&quot;,...}];

# After fix: functions are defined, onclick handlers work
> typeof showSecretValue
"function"
```

## Related Files

- `src/admin/views/secrets.tsx` — the file that hit this bug
- `src/admin/views/env-editor.tsx` — existing env editor that works without `raw()` (no inline JSON)
- `docs/knowledge/architecture/admin-env-editor-dataflow.md` — env editor architecture context
- Hono docs: `https://hono.dev/docs/helpers/html` — `html` and `raw` API reference

## Tags

`hono` `ssr` `html-escaping` `javascript` `inline-script` `raw` `troubleshooting`
