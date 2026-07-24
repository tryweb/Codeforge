import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Layout } from "./layout";

const GlabAuthContent: FC<{ status: string }> = ({ status }) => {
  const authenticated = status === "authenticated";
  return (
    <div>
      <h2 style="margin-bottom:24px;">GitLab CLI Authentication</h2>
      <div class="card">
        <h3>Status: <span class={`badge ${authenticated ? "badge-success" : "badge-warning"}`}>{status}</span></h3>
        <div class="form-group">
          <label for="hostname">GitLab Instance (for self-hosted)</label>
          <input type="text" id="hostname" placeholder="gitlab.com" value="gitlab.com" />
        </div>
        {authenticated
          ? <button onclick="logout()" class="btn-danger">Disconnect GitLab</button>
          : <button onclick="startAuth()" class="btn">Connect GitLab</button>
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
        let pollInterval = null;
        async function startAuth() {
          const hostname = document.getElementById("hostname").value.trim() || "gitlab.com";
          document.getElementById("auth-flow").style.display = "block";
          const res = await fetch("/api/auth/glab/start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hostname }),
          });
          const data = await res.json();
          document.getElementById("device-code-display").textContent = data.device_code || "---";
          document.getElementById("verification-url").textContent = data.verification_uri || "https://gitlab.com/activate";
          document.getElementById("verification-url").href = data.verification_uri || "https://gitlab.com/activate";
          let countdown = 900;
          document.getElementById("countdown").textContent = "Code expires in " + Math.floor(countdown / 60) + ":" + String(countdown % 60).padStart(2, "0");
          const countInterval = setInterval(() => { countdown--;
            if (countdown <= 0) clearInterval(countInterval);
            document.getElementById("countdown").textContent = "Code expires in " + Math.floor(countdown / 60) + ":" + String(countdown % 60).padStart(2, "0"); }, 1000);
          pollInterval = setInterval(async () => {
            const statusRes = await fetch("/api/auth/glab/status");
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
          await fetch("/api/auth/glab/logout", { method: "POST" });
          location.reload();
        }
      `}</script>
    </div>
  );
};

export function GitLabAuthPage(status: string) {
  return (
    <Layout title="GitLab Auth" currentPath="/auth/gitlab">
      <GlabAuthContent status={status} />
    </Layout>
  );
}
