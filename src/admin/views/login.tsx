import { html } from "hono/html";

export function LoginPage(redirect?: string) {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login — ai-admin</title>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="alternate icon" href="/static/favicon.ico" sizes="any" />
  <link rel="stylesheet" href="/static/style.css" />
</head>
<body>
  <div class="auth-page">
    <div class="auth-card">
      <h1>ai-admin</h1>
      <p>Enter your admin password to continue.</p>
      <form action="/api/login" method="POST">
        <input type="hidden" name="redirect" value="${redirect || "/"}" />
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autofocus />
        </div>
        <div class="form-actions">
          <button type="submit">Sign In</button>
        </div>
      </form>
      <p id="error" class="text-sm text-danger" style="display:none;margin-top:12px;"></p>
    </div>
  </div>
  <script>
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "1") {
      document.getElementById("error").style.display = "block";
      document.getElementById("error").textContent = "Invalid password. Please try again.";
    }
  </script>
</body>
</html>`;
}
