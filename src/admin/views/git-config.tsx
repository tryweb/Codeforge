import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const GitConfigContent: FC<{ config: Record<string, string>; credentials: string[] }> = ({ config, credentials }) => (
  <div>
    <h2 style="margin-bottom:24px;">Git Configuration</h2>
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
        <button onclick="saveConfig()">Save</button>
      </div>
      <div class="card">
        <h3>Current Config</h3>
        <pre>{Object.entries(config).map(([k, v]) => `${k}=${v}`).join("\n") || "No config set"}</pre>
      </div>
    </div>
    <div class="card">
      <h3>Stored Credentials</h3>
      {credentials.length > 0
        ? <ul>{credentials.map(c => <li><code>{c}</code></li>)}</ul>
        : <p class="text-muted">No stored credentials found.</p>
      }
    </div>
    <script>{`
      async function saveConfig() {
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
  </div>
);

export function GitConfigPage(config: Record<string, string>, credentials: string[]) {
  return (
    <Layout title="Git Config" currentPath="/git-config">
      <GitConfigContent config={config} credentials={credentials} />
    </Layout>
  );
}
