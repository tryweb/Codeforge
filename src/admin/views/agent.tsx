import { html } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout";

export interface AgentSettingsState {
  state: "disabled" | "connected" | "disconnected";
  last_error: string | null;
}

interface AgentSettingsProps {
  status: AgentSettingsState;
  env: Record<string, string>;
}

const AGENT_FIELDS: Array<{ key: string; secret: boolean; placeholder: string; help: string }> = [
  { key: "CENTER_URL", secret: false, placeholder: "wss://center.example.com/ws?token=...&ca=...", help: "Center registration URL. Token and CA certificate are read from it automatically. Leave empty to disable agent mode." },
  { key: "CENTER_TOKEN", secret: true, placeholder: "", help: "Pre-shared token fallback when the URL carries no token." },
  { key: "AGENT_ID", secret: false, placeholder: "(container hostname)", help: "Agent identifier reported in the hello handshake." },
];

const AgentSettingsContent: FC<AgentSettingsProps> = ({ status, env }) => (
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2>Agent Connection</h2>
      <span id="save-status" class="text-sm text-muted" style="align-self:center;"></span>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:12px;">Connection Status</h3>
      <div class="flex" style="gap:24px;align-items:center;flex-wrap:wrap;">
        <span id="agent-state-badge" class={`badge ${status.state === "connected" ? "badge-success" : status.state === "disabled" ? "" : "badge-warning"}`}>{status.state}</span>
        <span id="agent-last-error" class="text-sm text-muted">{status.last_error ? `Last error: ${status.last_error}` : ""}</span>
        <button class="btn-outline" style="padding:4px 10px;font-size:0.75rem;margin-left:auto;" onclick="refreshStatus()">↻ Refresh</button>
      </div>
      <p class="text-sm text-muted" style="margin-top:12px;">
        The agent connects outbound to the Center Server over WebSocket and answers remote commands (upgrade,
        reconfigure, restart) plus queries (status, env.get, projects.list, providers.list). Use the registration
        URL provided by your Center — it carries the token and CA certificate, so no certificate files are needed.
        Settings below apply immediately — the agent reconnects with the new configuration.
      </p>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">Center Server Settings</h3>
      {AGENT_FIELDS.map((field) => {
        const value = env[field.key] ?? "";
        const fieldId = `ag-${field.key}`;
        return (
          <div class="form-group" data-field-key={field.key}>
            <label for={fieldId}>{field.key}</label>
            <div class="flex" style="gap:4px;align-items:center;">
              <input type={field.secret ? "password" : "text"} id={fieldId} value={value} placeholder={field.placeholder} autocomplete={field.secret ? "new-password" : "off"} style="flex:1;" />
              {field.secret && value !== "" && <button type="button" class="btn-outline" style="padding:4px 10px;font-size:0.75rem;" onclick={`toggleSecret('${field.key}')`}>Show</button>}
            </div>
            <div class="text-sm text-muted" style="margin-top:4px;">{field.help}</div>
          </div>
        );
      })}
      <div class="flex gap-2" style="justify-content:flex-end;margin-top:8px;">
        <button id="btn-save-agent" onclick="saveAgentConfig()">Save &amp; Apply</button>
      </div>
    </div>

    <script>{html`
      function toggleSecret(key) {
        const input = document.getElementById("ag-" + key);
        const btn = input.parentElement.querySelector("button");
        if (input.type === "password") { input.type = "text"; btn.textContent = "Hide"; }
        else { input.type = "password"; btn.textContent = "Show"; }
      }

      function setBadge(state) {
        const badge = document.getElementById("agent-state-badge");
        badge.textContent = state;
        badge.className = "badge" + (state === "connected" ? " badge-success" : state === "disabled" ? "" : " badge-warning");
      }

      async function refreshStatus() {
        try {
          const res = await fetch("/api/agent/status");
          const data = await res.json();
          setBadge(data.state);
          document.getElementById("agent-last-error").textContent = data.last_error ? "Last error: " + data.last_error : "";
        } catch (e) {
          document.getElementById("agent-last-error").textContent = "Status refresh failed: " + e.message;
        }
      }

      async function saveAgentConfig() {
        const btn = document.getElementById("btn-save-agent");
        const status = document.getElementById("save-status");
        const values = {};
        document.querySelectorAll("[data-field-key]").forEach(function (group) {
          const key = group.dataset.fieldKey;
          values[key] = group.querySelector("input").value.trim();
        });
        btn.disabled = true;
        status.textContent = "Applying...";
        try {
          const res = await fetch("/api/agent/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values),
          });
          const data = await res.json();
          if (res.ok) {
            status.textContent = "Saved — agent " + data.agent_status.state + " ✔";
            setBadge(data.agent_status.state);
            document.getElementById("agent-last-error").textContent = data.agent_status.last_error ? "Last error: " + data.agent_status.last_error : "";
          } else {
            status.textContent = "Error: " + (data.error || "unknown");
          }
        } catch (e) {
          status.textContent = "Error: " + e.message;
        } finally {
          btn.disabled = false;
        }
      }
    `}</script>
  </div>
);

export function AgentSettingsPage(props: AgentSettingsProps) {
  return (
    <Layout title="Agent" currentPath="/agent">
      <AgentSettingsContent {...props} />
    </Layout>
  );
}