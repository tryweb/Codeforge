import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Layout } from "./layout";

const GhAuthContent: FC<{ status: string }> = ({ status }) => {
  const authenticated = status === "authenticated";
  return (
    <div>
      <h2 style="margin-bottom:24px;">GitHub CLI Authentication</h2>
      <div class="card">
        <div id="gh-user-info" />
        <h3>Status: <span class={`badge ${authenticated ? "badge-success" : "badge-warning"}`}>{status}</span></h3>
        {authenticated
          ? <button onclick="logout()" class="btn-danger">Disconnect GitHub</button>
          : <button onclick="startAuth()" class="btn">Connect GitHub</button>
        }
      </div>
      <div id="auth-flow" style="display:none;" class="card">
        <h3>Device Code</h3>
        <p class="text-sm text-muted">Open the verification URL and enter the code below.</p>
        <div id="device-code-display" class="device-code" />
        <p class="text-sm text-muted mb-4">Visit: <a id="verification-url" href="#" target="_blank" /></p>
        <div class="countdown" id="countdown" />
        <div id="poll-status" class="text-sm text-muted mt-4" />
      </div>
      <script>{html`
        fetch("/api/auth/gh/user").then(r => r.json()).then(function(u) {
          if (u.login) {
            var el = document.getElementById("gh-user-info");
            el.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">' +
              '<img src="' + u.avatar_url + '" alt="" style="width:48px;height:48px;border-radius:50%;" />' +
              '<div><strong style="font-size:1.05rem;">' + u.login + '</strong>' +
              (u.name ? '<br/><span class="text-muted" style="font-size:0.85rem;">' + u.name + '</span>' : '') +
              (u.scopes && u.scopes.length ? '<br/><span class="text-muted" style="font-size:0.75rem;">Scopes: ' + u.scopes.join(", ") + '</span>' : '') +
              '</div></div>';
          }
        });
        let pollInterval = null;
        async function startAuth() {
          document.getElementById("auth-flow").style.display = "block";
          const res = await fetch("/api/auth/gh/start", { method: "POST" });
          const data = await res.json();
          document.getElementById("device-code-display").textContent = data.device_code || "---";
          document.getElementById("verification-url").textContent = data.verification_uri || "https://github.com/login/device";
          document.getElementById("verification-url").href = data.verification_uri || "https://github.com/login/device";
          let countdown = 900;
          document.getElementById("countdown").textContent = "Code expires in " + Math.floor(countdown / 60) + ":" + String(countdown % 60).padStart(2, "0");
          const countInterval = setInterval(() => { countdown--; if (countdown <= 0) clearInterval(countInterval);
            document.getElementById("countdown").textContent = "Code expires in " + Math.floor(countdown / 60) + ":" + String(countdown % 60).padStart(2, "0"); }, 1000);
          pollInterval = setInterval(async () => {
            const statusRes = await fetch("/api/auth/gh/status");
            const statusData = await statusRes.json();
            if (statusData.status === "authenticated") {
              clearInterval(pollInterval); clearInterval(countInterval);
              document.getElementById("poll-status").innerHTML = '<strong class="text-success">✓ Authenticated!</strong>';
              setTimeout(() => location.reload(), 1500);
            } else {
              document.getElementById("poll-status").textContent = "Waiting for authentication...";
            }
          }, 3000);
        }
        async function logout() {
          await fetch("/api/auth/gh/logout", { method: "POST" });
          location.reload();
        }
      `}</script>
    </div>
  );
};

export function GitHubAuthPage(status: string) {
  return (
    <Layout title="GitHub Auth" currentPath="/auth/github">
      <GhAuthContent status={status} />
    </Layout>
  );
}
