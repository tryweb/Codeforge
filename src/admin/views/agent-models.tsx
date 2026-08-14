import { html, raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { AgentModelEntry } from "../lib/agent-models";

interface AgentModelsState {
  agents: AgentModelEntry[];
  catalog: string[];
  hasPassword: boolean;
}

const VARIANTS = ["low", "medium", "high", "xhigh", "max"];

const AgentModelsContent: FC<{ state: AgentModelsState }> = ({ state }) => {
  const json = raw(
    JSON.stringify({ agents: state.agents, catalog: state.catalog }).replace(/</g, "\\u003c"),
  );
  return (
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2>Agent Models</h2>
        <span id="restart-status" class="text-sm text-muted" style="align-self:center;"></span>
      </div>

      {!state.hasPassword && (
        <div class="card" style="border-color:var(--danger);margin-bottom:16px;">
          <strong>Prerequisite missing:</strong> <code>OPENCODE_SERVER_PASSWORD</code> is not set in{" "}
          <code>.env</code>. Live resolved models and "Save &amp; Restart" are unavailable until it is
          set (see the Environment page).
        </div>
      )}

      <div class="card">
        <table id="agent-models-table">
          <tr>
            <th>Agent</th>
            <th>Configured fallback chain</th>
            <th>Resolved model</th>
            <th>Source</th>
            <th></th>
          </tr>
          {state.agents.map((a) => (
            <tr data-agent={a.name}>
              <td><code>{a.name}</code></td>
              <td>
                {a.configured.length === 0 ? (
                  <span class="text-muted">—</span>
                ) : (
                  a.configured
                    .map((e) => `${e.model}${e.variant ? ` (${e.variant})` : ""}`)
                    .join(", ")
                )}
              </td>
              <td>
                {a.resolved ? (
                  <code>
                    {a.resolved.modelID} @ {a.resolved.providerID}
                  </code>
                ) : (
                  <span class="text-muted">n/a</span>
                )}
              </td>
              <td>
                {a.invalid && (
                  <span
                    title="Config has keys the OMO plugin no longer recognizes (e.g. permission). Fix or remove them for overrides to take effect."
                    style={{ color: "#ef4444", fontSize: "0.75rem", marginRight: "0.5rem" }}
                  >
                    ⚠ invalid
                  </span>
                )}
                <span
                  style={{
                    color:
                      a.source === "configured"
                        ? "#22c55e"
                        : a.source === "inherited"
                          ? "#f59e0b"
                          : "#94a3b8",
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  {a.source}
                </span>
              </td>
              <td>
                <button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick={`editAgent('${a.name}')`}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </table>
      </div>

      <div id="edit-modal" class="modal-overlay" style="display:none;">
        <div class="modal" style="max-width:580px;">
          <h3 id="modal-title" style="margin-bottom:4px;">Edit fallback models</h3>
          <p class="text-sm text-muted" style="margin-bottom:12px;">
            First entry is the default; later entries are fallbacks when a provider is saturated.
            Saving restarts ai-dev.
          </p>
          <div id="model-rows"></div>
          <div class="flex gap-2" style="justify-content:flex-end;margin-top:14px;">
            <button class="btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn-outline" onclick="addRow()">+ Add entry</button>
            <button id="btn-save" onclick="saveAgent()">Save &amp; Restart</button>
          </div>
          <div id="save-result" class="text-sm" style="margin-top:12px;"></div>
        </div>
      </div>

      <script>{html`
        var agentModelsState = ${json};
        var editAgentName = null;

        function rowTemplate(model, variant) {
          var modelOpts = agentModelsState.catalog.map(function (m) {
            return '<option value="' + m + '"' + (m === model ? ' selected' : '') + '>' + m + '</option>';
          }).join('');
          var variantOpts = ['', ${raw(VARIANTS.map((v) => `"${v}"`).join(","))}].map(function (v) {
            return '<option value="' + v + '"' + (v === (variant || '') ? ' selected' : '') + '>' + (v || 'default') + '</option>';
          }).join('');
          return '<div class="model-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">' +
            '<select class="model-select" style="flex:1;">' + modelOpts + '</select>' +
            '<select class="variant-select" style="width:110px;">' + variantOpts + '</select>' +
            '<button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick="removeRow(this)">✕</button>' +
          '</div>';
        }

        function editAgent(name) {
          editAgentName = name;
          var agent = agentModelsState.agents.filter(function (a) { return a.name === name; })[0];
          var rows = document.getElementById('model-rows');
          rows.innerHTML = '';
          (agent && agent.configured.length ? agent.configured : [{}]).forEach(function (e) {
            rows.insertAdjacentHTML('beforeend', rowTemplate(e.model || '', e.variant || ''));
          });
          document.getElementById('save-result').textContent = '';
          document.getElementById('edit-modal').style.display = 'flex';
        }

        function addRow() {
          document.getElementById('model-rows').insertAdjacentHTML('beforeend', rowTemplate('', ''));
        }

        function removeRow(btn) {
          var rows = document.querySelectorAll('#model-rows .model-row');
          if (rows.length > 1) btn.parentNode.remove();
          else alert('At least one row is required; clear all models by leaving one empty row.');
        }

        function collectEntries() {
          var entries = [];
          document.querySelectorAll('#model-rows .model-row').forEach(function (row) {
            var model = row.querySelector('.model-select').value;
            var variant = row.querySelector('.variant-select').value;
            if (!model) return;
            var entry = { model: model };
            if (variant) entry.variant = variant;
            entries.push(entry);
          });
          return entries;
        }

        function closeModal() {
          document.getElementById('edit-modal').style.display = 'none';
        }

        function renderResult(r) {
          var el = document.getElementById('save-result');
          if (r.ok && r.status === 'verified') {
            var resolved = r.resolved ? r.resolved.modelID + ' @ ' + r.resolved.providerID : 'n/a';
            el.style.color = '#22c55e';
            el.textContent = 'Applied and restarted. Current model (plugin default): ' + resolved;
          } else if (!r.ok && r.status === 'unverified') {
            el.style.color = '#f59e0b';
            el.textContent = 'Applied but could not confirm the server came back: ' + r.error;
          } else if (!r.ok && (r.status === 'write_failed' || r.status === 'restart_failed')) {
            el.style.color = 'var(--danger)';
            el.textContent = 'Failed (configuration was not changed): ' + r.error;
          } else {
            el.style.color = 'var(--danger)';
            el.textContent = r.error || 'Unknown error';
          }
        }

        async function saveAgent() {
          var entries = collectEntries();
          if (!confirm('Save & restart ai-dev? Active OpenCode sessions will be interrupted.')) return;
          var btn = document.getElementById('btn-save');
          var status = document.getElementById('restart-status');
          btn.disabled = true;
          status.textContent = 'Applying & restarting…';
          try {
            var res = await fetch('/api/agent-models/' + encodeURIComponent(editAgentName), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ entries: entries }),
            });
            var data = await res.json();
            if (!res.ok) {
              renderResult({ ok: false, error: data.error || ('HTTP ' + res.status) });
              btn.disabled = false;
              status.textContent = '';
              return;
            }
            renderResult(data);
            status.textContent = 'Restarted ✔';
            setTimeout(function () { status.textContent = ''; btn.disabled = false; location.reload(); }, 2500);
          } catch (e) {
            renderResult({ ok: false, error: e.message });
            btn.disabled = false;
            status.textContent = '';
          }
        }
      `}</script>
    </div>
  );
};

export function AgentModelsPage(state: AgentModelsState) {
  return (
    <Layout title="Agent Models" currentPath="/agent-models">
      <AgentModelsContent state={state} />
    </Layout>
  );
}
