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

      <div id="batch-bar" class="card" style="display:none; margin-bottom:16px; background:rgba(245,158,11,0.1); border-color:#f59e0b;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span id="batch-count" class="text-sm" style="font-weight:600;"></span>
          <div style="display:flex; gap:8px;">
            <button id="btn-discard" class="btn-outline" onclick="discardPending()" style="padding:6px 12px;">Discard</button>
            <button id="btn-apply" onclick="applyPending()" style="padding:6px 16px; background:#f59e0b; color:#000; font-weight:600;">Apply</button>
          </div>
        </div>
        <div id="batch-status" class="text-sm" style="margin-top:8px;"></div>
      </div>

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
          .dirty-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #f59e0b;
            border-radius: 50%;
            margin-left: 6px;
            vertical-align: middle;
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
                <span class="configured-value">
                  {a.configured.length === 0 ? (
                    <span class="text-muted">—</span>
                  ) : (
                    (() => {
                      const e = a.configured[0];
                      if (!e) return "—";
                      return `${e.model}${e.variant ? ` (${e.variant})` : ""}`;
                    })()
                  )}
                </span>
                <span class="dirty-dot" style="display:none;" title="Pending change"></span>
                <div class="pending-value text-sm" style="display:none; color:#f59e0b;"></div>
                <div class="batch-result text-sm" style="display:none;"></div>
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
            plugin honors them. Changes are collected locally — press Apply to restart once.
          </p>
          <div id="model-rows"></div>
          <div class="flex gap-2" style="justify-content:flex-end;margin-top:14px;">
            <button id="btn-cancel" class="btn-outline" onclick="closeModal()">Cancel</button>
            <button id="btn-clear" class="btn-outline" style="display:none;" onclick="clearAgent()">Use automatic model</button>
            <button id="btn-save" onclick="saveAgent()">Save to pending</button>
          </div>
          <div id="save-result" class="text-sm" style="margin-top:12px;"></div>
        </div>
      </div>

      <script>{html`
        var agentModelsState = ${json};
        var editAgentName = null;
        var pending = new Map();

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
          var pendingEntries = pending.get(name);
          var rows = document.getElementById('model-rows');
          rows.innerHTML = '';
          var primary;
          if (pendingEntries !== undefined) {
            primary = pendingEntries[0] || {};
          } else {
            primary = agent && agent.configured.length ? agent.configured[0] : {};
          }
          rows.insertAdjacentHTML('beforeend', rowTemplate(primary.model || '', primary.variant || ''));
          document.getElementById('btn-clear').style.display = (pendingEntries !== undefined ? pendingEntries.length === 0 : agent && agent.configured.length) ? 'inline-block' : 'none';
          // Show pending vs configured hint
          var hint = pendingEntries !== undefined ? ' (pending: ' + (pendingEntries.length ? pendingEntries[0].model : 'automatic') + ')' : '';
          document.getElementById('modal-title').textContent = 'Edit primary model' + hint;
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

        function updateBatchBar() {
          var bar = document.getElementById('batch-bar');
          var count = document.getElementById('batch-count');
          var applyBtn = document.getElementById('btn-apply');
          if (pending.size === 0) {
            bar.style.display = 'none';
            return;
          }
          bar.style.display = 'block';
          count.textContent = pending.size + ' pending change' + (pending.size > 1 ? 's' : '');
          applyBtn.textContent = 'Apply (' + pending.size + ')';
        }

        function updateRowDirtyState() {
          document.querySelectorAll('#agent-models-table tr[data-agent]').forEach(function (tr) {
            var agent = tr.getAttribute('data-agent');
            var pendingEntries = pending.get(agent);
            var dot = tr.querySelector('.dirty-dot');
            var pendingEl = tr.querySelector('.pending-value');
            var configuredEl = tr.querySelector('.configured-value');
            var batchResultEl = tr.querySelector('.batch-result');
            if (pendingEntries !== undefined) {
              if (dot) dot.style.display = 'inline-block';
              if (pendingEl) {
                pendingEl.style.display = 'block';
                pendingEl.textContent = '→ ' + (pendingEntries.length ? pendingEntries[0].model + (pendingEntries[0].variant ? ' (' + pendingEntries[0].variant + ')' : '') : 'automatic');
              }
              if (configuredEl) configuredEl.style.opacity = '0.5';
              if (batchResultEl) batchResultEl.style.display = 'none';
            } else {
              if (dot) dot.style.display = 'none';
              if (pendingEl) pendingEl.style.display = 'none';
              if (configuredEl) configuredEl.style.opacity = '1';
            }
          });
        }

        function saveAgent() {
          var entries = collectEntries();
          pending.set(editAgentName, entries);
          updateRowDirtyState();
          updateBatchBar();
          closeModal();
          var resultEl = document.getElementById('save-result');
          // Clear any previous batch result for this agent
          var tr = document.querySelector('tr[data-agent="' + editAgentName + '"]');
          if (tr) {
            var batchResultEl = tr.querySelector('.batch-result');
            if (batchResultEl) batchResultEl.style.display = 'none';
          }
        }

        function clearAgent() {
          pending.set(editAgentName, []);
          updateRowDirtyState();
          updateBatchBar();
          closeModal();
        }

        function discardPending() {
          pending.clear();
          updateRowDirtyState();
          updateBatchBar();
          document.querySelectorAll('.batch-result').forEach(function (el) { el.style.display = 'none'; el.textContent = ''; });
          document.getElementById('batch-status').textContent = '';
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

        function renderBatchResults(results) {
          Object.keys(results).forEach(function (agent) {
            var r = results[agent];
            var tr = document.querySelector('tr[data-agent="' + agent + '"]');
            if (!tr) return;
            var batchResultEl = tr.querySelector('.batch-result');
            if (!batchResultEl) return;
            batchResultEl.style.display = 'block';
            if (r.ok) {
              batchResultEl.style.color = '#22c55e';
              batchResultEl.textContent = r.status === 'cleared' ? 'cleared → ' + (r.resolved ? r.resolved.modelID + ' @ ' + r.resolved.providerID : 'n/a') : 'verified → ' + (r.requestVerified ? r.requestVerified.modelID + ' @ ' + r.requestVerified.providerID : r.resolved ? r.resolved.modelID + ' @ ' + r.resolved.providerID : 'n/a');
            } else {
              batchResultEl.style.color = r.status === 'unverified' ? '#f59e0b' : 'var(--danger)';
              batchResultEl.textContent = r.status + ': ' + (r.error || 'Unknown error');
            }
          });
        }

        async function applyPending() {
          if (pending.size === 0) return;
          if (!confirm('Apply ' + pending.size + ' change' + (pending.size > 1 ? 's' : '') + ' & restart ai-dev? Active OpenCode sessions will be interrupted.')) return;
          var applyBtn = document.getElementById('btn-apply');
          var discardBtn = document.getElementById('btn-discard');
          var status = document.getElementById('restart-status');
          var batchStatus = document.getElementById('batch-status');
          var modal = document.getElementById('edit-modal');
          applyBtn.disabled = true;
          discardBtn.disabled = true;
          disableTableRows();
          if (modal) {
            modal.classList.add('disabled');
            modal.style.display = 'none';
          }

          var banner = document.createElement('div');
          banner.className = 'restart-banner';
          banner.innerHTML = '<span class="spinner"></span> Applying ' + pending.size + ' change' + (pending.size > 1 ? 's' : '') + ' &amp; restarting… This restarts ai-dev and typically takes 30–60 seconds.';
          document.body.appendChild(banner);

          var elapsed = 0;
          status.innerHTML = '<span class="spinner"></span> Applying &amp; restarting… <span class="probe-hint">This restarts ai-dev and typically takes 30–60 seconds.</span> <span class="probe-elapsed">0s</span>';
          batchStatus.textContent = 'Restarting…';
          var timer = setInterval(function () {
            elapsed += 1;
            var el = status.querySelector('.probe-elapsed');
            if (el) el.textContent = elapsed + 's';
          }, 1000);
          try {
            var changes = Array.from(pending.entries()).map(function (kv) { return { agent: kv[0], entries: kv[1] }; });
            var res = await fetch('/api/agent-models', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ changes: changes }),
            });
            var data = await res.json();
            clearInterval(timer);
            if (!res.ok) {
              batchStatus.style.color = 'var(--danger)';
              batchStatus.textContent = data.error || ('HTTP ' + res.status);
              applyBtn.disabled = false;
              discardBtn.disabled = false;
              enableTableRows();
              status.textContent = '';
              return;
            }
            // data.results is Record<agent, ApplyResult>
            var results = data.results || {};
            renderBatchResults(results);
            var failed = Object.keys(results).filter(function (k) { return !results[k].ok; });
            if (failed.length === 0) {
              batchStatus.style.color = '#22c55e';
              batchStatus.textContent = 'Applied and restarted (' + Object.keys(results).length + ' agents). Reloading…';
              status.textContent = 'Restarted ✔';
              setTimeout(function () { status.textContent = ''; batchStatus.textContent = ''; applyBtn.disabled = false; discardBtn.disabled = false; enableTableRows(); pending.clear(); updateRowDirtyState(); updateBatchBar(); location.reload(); }, 2500);
            } else {
              batchStatus.style.color = 'var(--danger)';
              batchStatus.textContent = failed.length + ' failed: ' + failed.join(', ') + '. See per-row status.';
              applyBtn.disabled = false;
              discardBtn.disabled = false;
              enableTableRows();
              status.textContent = '';
              // Keep pending for failed ones, clear succeeded? For now keep all pending for retry
            }
          } catch (e) {
            clearInterval(timer);
            batchStatus.style.color = 'var(--danger)';
            batchStatus.textContent = e.message;
            applyBtn.disabled = false;
            discardBtn.disabled = false;
            enableTableRows();
            status.textContent = '';
          }
        }

        // Legacy single-agent path kept for compatibility (not used by new UI)
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
              var el = document.getElementById('save-result');
              el.style.color = 'var(--danger)';
              el.textContent = data.error || ('HTTP ' + res.status);
              btn.disabled = false;
              clearBtn.disabled = false;
              if (cancelBtn) cancelBtn.disabled = false;
              enableTableRows();
              status.textContent = '';
              return;
            }
            var el = document.getElementById('save-result');
            if (data.ok && data.status === 'cleared') {
              var automatic = data.resolved ? data.resolved.modelID + ' @ ' + data.resolved.providerID : 'n/a';
              el.style.color = '#22c55e';
              el.textContent = 'Configured model cleared. Automatic model: ' + automatic;
            } else if (data.ok && data.status === 'verified') {
              var resolved = data.resolved ? data.resolved.modelID + ' @ ' + data.resolved.providerID : 'n/a';
              var requestVerified = data.requestVerified ? data.requestVerified.modelID + ' @ ' + data.requestVerified.providerID : 'not verified';
              el.style.color = '#22c55e';
              el.textContent = 'Applied and restarted. Successful request model: ' + requestVerified + ' (assigned: ' + resolved + ')';
            } else if (!data.ok && data.status === 'unverified') {
              el.style.color = '#f59e0b';
              el.textContent = 'Applied but could not confirm the server came back: ' + data.error;
            } else if (!data.ok && data.status === 'rollback_failed') {
              el.style.color = 'var(--danger)';
              el.textContent = 'Restart and rollback failed; configuration state may have changed: ' + data.error;
            } else if (!data.ok && (data.status === 'write_failed' || data.status === 'restart_failed')) {
              el.style.color = 'var(--danger)';
              el.textContent = 'Failed (configuration was not changed): ' + data.error;
            } else {
              el.style.color = 'var(--danger)';
              el.textContent = data.error || 'Unknown error';
            }
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
            var el = document.getElementById('save-result');
            el.style.color = 'var(--danger)';
            el.textContent = e.message;
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
