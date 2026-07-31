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
    <td><button class="btn-outline" style="padding:3px 6px;font-size:0.7rem;" onclick={`removeInstance('${inst.hostname}')`}>Remove</button></td>
  </tr>
);

const GlabAuthContent: FC<{ instances: GlabInstance[]; status: string }> = ({ instances, status }) => {
  const authenticated = status === "authenticated";
  return (
    <div>
      <h2 style="margin-bottom:24px;">GitLab CLI Authentication</h2>

      <div class="card">
        <h3>Configured Instances</h3>
        {instances.length > 0
          ? <table>
              <tr><th>Hostname</th><th>User</th><th>Status</th><th></th></tr>
              {instances.map(inst => <GlabInstanceRow inst={inst} />)}
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
            <button class="btn-outline" style="padding:4px 10px;font-size:0.75rem;" onclick="toggleTokenVis()">Show</button>
          </div>
        </div>
        <button onclick="startAuth()" class="btn">Connect</button>
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
        function toggleTokenVis() {
          const el = document.getElementById("token");
          const btn = el.nextElementSibling;
          if (el.type === "password") { el.type = "text"; btn.textContent = "Hide"; }
          else { el.type = "password"; btn.textContent = "Show"; }
        }
        async function startAuth() {
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
        async function removeInstance(hostname) {
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

export function GitLabAuthPage(instances: GlabInstance[], status: string) {
  return (
    <Layout title="GitLab Auth" currentPath="/auth/gitlab">
      <GlabAuthContent instances={instances} status={status} />
    </Layout>
  );
}
