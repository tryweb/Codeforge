import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Layout } from "./layout";

interface GlabInstance {
  hostname: string;
  username: string;
  authenticated: boolean;
}

const GlabInstanceRow: FC<{ inst: GlabInstance }> = ({ inst }) => (
  <tr>
    <td><code>{inst.hostname}</code></td>
    <td>{inst.username || <span class="text-muted">—</span>}</td>
    <td><span class={`badge ${inst.authenticated ? "badge-success" : "badge-warning"}`}>{inst.authenticated ? "authenticated" : "not authenticated"}</span></td>
    <td><button class="btn-outline" style="padding:3px 6px;font-size:0.7rem;" onclick={`removeGlabInstance('${inst.hostname}')`}>Remove</button></td>
  </tr>
);

const GitHostingContent: FC<{ ghStatus: string; glabInstances: GlabInstance[]; glabStatus: string; config: Record<string, string> }> = ({ ghStatus, glabInstances, glabStatus, config }) => {
  const ghAuthenticated = ghStatus === "authenticated";
  return (
    <div>
      <h2 style="margin-bottom:24px;">Git Hosting</h2>
      <h3 style="margin-bottom:12px;">Git Configuration</h3>
      <div class="grid-2">
      <div class="card">
        <h3>Identity</h3>
        <div class="form-group">
          <label>User Name</label>
          <input type="text" id="user-name" value={config["user.name"] || ""} />
        </div>
        <div class="form-group">
          <label>User Email</label>
          <input type="email" id="user-email" value={config["user.email"] || ""} />
        </div>
        <button onclick="saveGitConfig()">Save</button>
      </div>
      <div class="card">
        <h3>Current Config</h3>
        <pre>{Object.entries(config).map(([k, v]) => `${k}=${v}`).join("\n") || "No config set"}</pre>
      </div>
      </div>

      <h3 style="margin-bottom:12px;margin-top:24px;">GitHub CLI Authentication</h3>
      <div class="card">
        <div id="gh-user-info" />
        <h3>Status: <span class={`badge ${ghAuthenticated ? "badge-success" : "badge-warning"}`}>{ghStatus}</span></h3>
        {ghAuthenticated
          ? <button onclick="ghLogout()" class="btn-danger">Disconnect GitHub</button>
          : <button onclick="startGhAuth()" class="btn">Connect GitHub</button>
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

      <h3 style="margin-bottom:12px;margin-top:24px;">GitLab CLI Authentication</h3>
      <div class="card">
        <h3>Configured Instances</h3>
        {glabInstances.length > 0
          ? <table>
              <tr><th>Hostname</th><th>User</th><th>Status</th><th></th></tr>
              {glabInstances.map(inst => <GlabInstanceRow inst={inst} />)}
            </table>
          : <p class="text-muted">No GitLab instances configured.</p>
        }
      </div>

      <div class="card">
        <h3>Add Instance</h3>
        <div class="form-group">
          <label for="hostname">GitLab Hostname</label>
          <input type="text" id="hostname" placeholder="gitlab-238.ichiayi.com" />
        </div>
        <div class="form-group">
          <label for="token">Personal Access Token</label>
          <div style="display:flex;gap:4px;">
            <input type="password" id="token" placeholder="glpat-..." style="flex:1;" />
            <button class="btn-outline" style="padding:4px 10px;font-size:0.75rem;" onclick="toggleGlabTokenVis()">Show</button>
          </div>
        </div>
        <button onclick="startGlabAuth()" class="btn">Connect</button>
      </div>

      <script>{html`
        async function saveGitConfig() {
          const name = document.getElementById("user-name").value.trim();
          const email = document.getElementById("user-email").value.trim();
          let ok = true;
          if (name) {
            const r1 = await fetch("/api/git/config", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: "user.name", value: name }),
            }); if (!r1.ok) ok = false;
          }
          if (email) {
            const r2 = await fetch("/api/git/config", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: "user.email", value: email }),
            }); if (!r2.ok) ok = false;
          }
          if (ok) { location.reload(); } else { alert("Failed to save config"); }
        }
      `}</script>
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
        let ghPollInterval = null;
        async function startGhAuth() {
          document.getElementById("auth-flow").style.display = "block";
          const res = await fetch("/api/auth/gh/start", { method: "POST" });
          const data = await res.json();
          document.getElementById("device-code-display").textContent = data.device_code || "---";
          document.getElementById("verification-url").textContent = data.verification_uri || "https://github.com/login/device";
          document.getElementById("verification-url").href = data.verification_uri || "https://github.com/login/device";
          let countdown = 900;
          document.getElementById("countdown").textContent = "Code expires in " + Math.floor(countdown / 60) + ":" + String(countdown % 60).padStart(2, "0");
          const ghCountInterval = setInterval(() => { countdown--; if (countdown <= 0) clearInterval(ghCountInterval);
            document.getElementById("countdown").textContent = "Code expires in " + Math.floor(countdown / 60) + ":" + String(countdown % 60).padStart(2, "0"); }, 1000);
          ghPollInterval = setInterval(async () => {
            const statusRes = await fetch("/api/auth/gh/status");
            const statusData = await statusRes.json();
            if (statusData.status === "authenticated") {
              clearInterval(ghPollInterval); clearInterval(ghCountInterval);
              document.getElementById("poll-status").innerHTML = '<strong class="text-success">✓ Authenticated!</strong>';
              setTimeout(() => location.reload(), 1500);
            } else {
              document.getElementById("poll-status").textContent = "Waiting for authentication...";
            }
          }, 3000);
        }
        async function ghLogout() {
          await fetch("/api/auth/gh/logout", { method: "POST" });
          location.reload();
        }
        function toggleGlabTokenVis() {
          const el = document.getElementById("token");
          const btn = el.nextElementSibling;
          if (el.type === "password") { el.type = "text"; btn.textContent = "Hide"; }
          else { el.type = "password"; btn.textContent = "Show"; }
        }
        async function startGlabAuth() {
          const hostname = document.getElementById("hostname").value.trim();
          if (!hostname) { alert("Please enter a GitLab host URL"); return; }
          const token = document.getElementById("token").value.trim();
          if (!token) { alert("Please enter a Personal Access Token"); return; }
          const btn = event.target;
          btn.disabled = true; btn.textContent = "Connecting...";
          const res = await fetch("/api/auth/glab/start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hostname, token }),
          });
          if (res.ok) { location.reload(); }
          else { const d = await res.json(); alert(d.error || "Auth failed"); btn.disabled = false; btn.textContent = "Connect"; }
        }
        async function removeGlabInstance(hostname) {
          if (!confirm("Remove \\"" + hostname + "\\"? Logout from this GitLab instance.")) return;
          await fetch("/api/auth/glab/logout", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hostname }),
          });
          location.reload();
        }
      `}</script>
    </div>
  );
};

export function GitHostingPage(ghStatus: string, glabInstances: GlabInstance[], glabStatus: string, config: Record<string, string>) {
  return (
    <Layout title="Git Hosting" currentPath="/auth/git-hosting">
      <GitHostingContent ghStatus={ghStatus} glabInstances={glabInstances} glabStatus={glabStatus} config={config} />
    </Layout>
  );
}
