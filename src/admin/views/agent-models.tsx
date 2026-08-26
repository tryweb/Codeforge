import { html, raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { AgentModelEntry } from "../lib/agent-models";

interface AgentModelsState {
  agents: AgentModelEntry[];
  catalog: string[];
  hasPassword: boolean;
  catalogAvailable: boolean;
}

const VARIANTS = ["low", "medium", "high", "xhigh", "max"];

const AgentModelsContent: FC<{ state: AgentModelsState }> = ({ state }) => {
  const json = raw(
    JSON.stringify({
      agents: state.agents,
      catalog: state.catalog,
      hasPassword: state.hasPassword,
      catalogAvailable: state.catalogAvailable,
    }).replace(/</g, "\\u003c"),
  );
  return (
    <div>
      <div class="flex items-center justify-between mb-4">
        <h2>Agent Models</h2>
        <span id="restart-status" class="text-sm text-muted" style="align-self:center;"></span>
      </div>

      <p class="text-sm text-muted" style="margin-top:12px;">
        Per-subagent model overrides for the AI agents invoked by your primary agent (e.g. general).
        The primary agent's own model and internal mechanism agents (compaction, summary, title,
        build) are not configurable here.
      </p>
      <p class="text-sm text-muted" style="margin-top:8px;">
        <strong>Assigned model</strong> is OpenCode's current agent assignment. <strong>Last successful request</strong>
        is the model metadata returned by the most recent real request. A model is <strong>effective</strong> only when both
        match the configured model and its provider is connected.
      </p>

      {!state.hasPassword && (
        <div class="card" style="border-color:var(--danger);margin-bottom:16px;">
          <strong>Prerequisite missing:</strong> <code>OPENCODE_SERVER_PASSWORD</code> is not set in{" "}
          <code>.env</code>. Assigned models, request verification, and "Save &amp; Restart" are unavailable until it is
          set (see the Environment page).
        </div>
      )}

      {!state.catalogAvailable && (
        <div class="card" style="border-color:var(--danger);margin-bottom:16px;">
          <strong>Model catalog unavailable:</strong> Live provider models and the local OpenCode model catalog
          could not be read. Model selection is disabled until the catalog becomes available.
        </div>
      )}

      <div class="card">
        <style>{`
          .agent-models-table-disabled td {
            opacity: 0.4;
            pointer-events: none;
            cursor: not-allowed;
            background-color: rgba(0, 0, 0, 0.1);
          }
          .agent-models-table-disabled td:last-child .btn-outline {
            opacity: 0.4 !important;
            cursor: not-allowed !important;
          }
          .modal-overlay.disabled {
            opacity: 0.6;
            pointer-events: none;
          }
          .modal-overlay.disabled .modal {
            filter: grayscale(50%);
          }
          .restart-banner {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: #000;
            padding: 12px 20px;
            text-align: center;
            font-weight: 600;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            animation: pulse 2s infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
          }
          .restart-banner .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #000;
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <table id="agent-models-table">
          <tr>
            <th>Subagent</th>
            <th>Configured model</th>
            <th>Assigned model</th>
            <th>Last successful request</th>
            <th>Source / status</th>
            <th></th>
          </tr>
          {state.agents.map((a) => (
            <tr data-agent={a.name}>
              <td><code>{a.name}</code></td>
              <td>
                {a.configured.length === 0 ? (
                  <span class="text-muted">—</span>
                ) : (
                  (() => {
                    const e = a.configured[0];
                    if (!e) return "—";
                    return `${e.model}${e.variant ? ` (${e.variant})` : ""}`;
                  })()
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
                {a.requestVerified ? (
                  <code>
                    {a.requestVerified.modelID} @ {a.requestVerified.providerID}
                  </code>
                ) : (
                  <span class="text-muted">not verified</span>
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
                {" "}
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
                <span class="text-muted" style="font-size:0.75rem;margin-left:0.5rem;">
                  {a.effectiveness}
                </span>
              </td>
              <td>
                <button
                  class="btn-outline"
                  style={{
                    padding: "4px 8px",
                    fontSize: "0.75rem",
                    opacity: state.catalogAvailable && state.hasPassword ? 1 : 0.5,
                    cursor: state.catalogAvailable && state.hasPassword ? "pointer" : "not-allowed",
                  }}
                  title={!state.catalogAvailable ? "Model catalog unavailable" : !state.hasPassword ? "OpenCode password unavailable" : undefined}
                  disabled={!state.catalogAvailable || !state.hasPassword}
                  onclick={`editAgent('${a.name}')`}
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </table>
      </div>

      <div id="edit-modal" class="modal-overlay" style="display:none;">
        <div class="modal" style="max-width:580px;">
          <h3 id="modal-title" style="margin-bottom:4px;">Edit primary model</h3>
          <p class="text-sm text-muted" style="margin-bottom:12px;">
            Sets the model the subagent runs on. Fallback chains are not supported until the OMO
            plugin honors them; saving restarts ai-dev.
          </p>
          <div id="model-rows"></div>
          <div class="flex gap-2" style="justify-content:flex-end;margin-top:14px;">
            <button id="btn-cancel" class="btn-outline" onclick="closeModal()">Cancel</button>
            <button id="btn-clear" class="btn-outline" style="display:none;" onclick="clearAgent()">Use automatic model</button>
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
          '</div>';
        }

        function editAgent(name) {
          if (!agentModelsState.catalogAvailable || !agentModelsState.hasPassword) return;
          editAgentName = name;
          var agent = agentModelsState.agents.filter(function (a) { return a.name === name; })[0];
          var rows = document.getElementById('model-rows');
          rows.innerHTML = '';
          var primary = agent && agent.configured.length ? agent.configured[0] : {};
          rows.insertAdjacentHTML('beforeend', rowTemplate(primary.model || '', primary.variant || ''));
          document.getElementById('btn-clear').style.display = agent && agent.configured.length ? 'inline-block' : 'none';
          document.getElementById('save-result').textContent = '';
          document.getElementById('edit-modal').style.display = 'flex';
        }

        function collectEntries() {
          var row = document.querySelector('#model-rows .model-row');
          if (!row) return [];
          var model = row.querySelector('.model-select').value;
          var variant = row.querySelector('.variant-select').value;
          if (!model) return [];
          var entry = { model: model };
          if (variant) entry.variant = variant;
          return [entry];
        }

        function closeModal() {
          document.getElementById('edit-modal').style.display = 'none';
        }

        function disableTableRows() {
          var table = document.getElementById('agent-models-table');
          if (table) table.classList.add('agent-models-table-disabled');
        }

        function enableTableRows() {
          var table = document.getElementById('agent-models-table');
          if (table) table.classList.remove('agent-models-table-disabled');
          var modal = document.getElementById('edit-modal');
          if (modal) modal.classList.remove('disabled');
          var banner = document.querySelector('.restart-banner');
          if (banner) banner.remove();
        }

        function renderResult(r) {
          var el = document.getElementById('save-result');
          if (r.ok && r.status === 'cleared') {
            var automatic = r.resolved ? r.resolved.modelID + ' @ ' + r.resolved.providerID : 'n/a';
            el.style.color = '#22c55e';
            el.textContent = 'Configured model cleared. Automatic model: ' + automatic;
          } else if (r.ok && r.status === 'verified') {
            var resolved = r.resolved ? r.resolved.modelID + ' @ ' + r.resolved.providerID : 'n/a';
            var requestVerified = r.requestVerified ? r.requestVerified.modelID + ' @ ' + r.requestVerified.providerID : 'not verified';
            el.style.color = '#22c55e';
            el.textContent = 'Applied and restarted. Successful request model: ' + requestVerified + ' (assigned: ' + resolved + ')';
          } else if (!r.ok && r.status === 'unverified') {
            el.style.color = '#f59e0b';
            el.textContent = 'Applied but could not confirm the server came back: ' + r.error;
          } else if (!r.ok && r.status === 'rollback_failed') {
            el.style.color = 'var(--danger)';
            el.textContent = 'Restart and rollback failed; configuration state may have changed: ' + r.error;
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
          await submitAgentModel(entries, 'Save & restart ai-dev? Active OpenCode sessions will be interrupted.');
        }

        async function clearAgent() {
          await submitAgentModel([], 'Clear the configured model and restore automatic selection? Active OpenCode sessions will be interrupted.');
        }

        async function submitAgentModel(entries, confirmation) {
          if (!confirm(confirmation)) return;
          var btn = document.getElementById('btn-save');
          var clearBtn = document.getElementById('btn-clear');
          var cancelBtn = document.getElementById('btn-cancel');
          var status = document.getElementById('restart-status');
          var modal = document.getElementById('edit-modal');
          btn.disabled = true;
          clearBtn.disabled = true;
          if (cancelBtn) cancelBtn.disabled = true;
          disableTableRows();
          if (modal) {
            modal.classList.add('disabled');
            modal.style.display = 'none';
          }
          
          var banner = document.createElement('div');
          banner.className = 'restart-banner';
          banner.innerHTML = '<span class="spinner"></span> Applying &amp; restarting… This restarts ai-dev and typically takes 30–60 seconds.';
          document.body.appendChild(banner);
          
          var elapsed = 0;
          status.innerHTML = '<span class="spinner"></span> Applying &amp; restarting… <span class="probe-hint">This restarts ai-dev and typically takes 30–60 seconds.</span> <span class="probe-elapsed">0s</span>';
          var timer = setInterval(function () {
            elapsed += 1;
            var el = status.querySelector('.probe-elapsed');
            if (el) el.textContent = elapsed + 's';
          }, 1000);
          try {
            var res = await fetch('/api/agent-models/' + encodeURIComponent(editAgentName), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ entries: entries }),
            });
            var data = await res.json();
            clearInterval(timer);
            if (!res.ok) {
              renderResult({ ok: false, error: data.error || ('HTTP ' + res.status) });
              btn.disabled = false;
              clearBtn.disabled = false;
              if (cancelBtn) cancelBtn.disabled = false;
              enableTableRows();
              status.textContent = '';
              return;
            }
            renderResult(data);
            if (data.ok === true) {
              status.textContent = 'Restarted ✔';
              setTimeout(function () { status.textContent = ''; btn.disabled = false; clearBtn.disabled = false; if (cancelBtn) cancelBtn.disabled = false; enableTableRows(); location.reload(); }, 2500);
            } else {
              btn.disabled = false;
              clearBtn.disabled = false;
              if (cancelBtn) cancelBtn.disabled = false;
              enableTableRows();
              status.textContent = '';
            }
          } catch (e) {
            clearInterval(timer);
            renderResult({ ok: false, error: e.message });
            btn.disabled = false;
            clearBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
            enableTableRows();
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
