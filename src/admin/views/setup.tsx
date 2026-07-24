import { html } from "hono/html";

export function SetupPage() {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Setup — ai-admin</title>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="alternate icon" href="/static/favicon.ico" sizes="any" />
  <link rel="stylesheet" href="/static/style.css" />
</head>
<body>
  <div class="auth-page">
    <div class="auth-card">
      <h1>Configure Admin Password</h1>
      <p>This password will be written to .env and used to secure the dashboard.</p>
      <form id="setup-form">
        <div class="form-group">
          <label for="password">Password (min. 8 characters)</label>
          <input type="password" id="password" name="password" required minlength="8" />
        </div>
        <div class="form-group">
          <label for="confirm">Confirm Password</label>
          <input type="password" id="confirm" name="confirm" required minlength="8" />
        </div>
        <div id="error" class="text-sm text-danger" style="display:none;margin-bottom:12px;"></div>
        <div class="form-actions">
          <button type="submit">Set Password & Continue</button>
        </div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById("setup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = document.getElementById("password").value;
      const confirm = document.getElementById("confirm").value;
      const errEl = document.getElementById("error");
      if (password !== confirm) {
        errEl.style.display = "block"; errEl.textContent = "Passwords do not match.";
        return;
      }
      if (password.length < 8) {
        errEl.style.display = "block"; errEl.textContent = "Password must be at least 8 characters.";
        return;
      }
      const res = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      if (res.ok) { window.location.href = "/"; }
      else { const data = await res.json(); errEl.style.display = "block"; errEl.textContent = data.error || "Setup failed."; }
    });
  </script>
</body>
</html>`;
}
