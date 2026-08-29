import { html, raw } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { getSchemaBySection, type LeanCtxSchemaEntry } from "../lib/leanctx-schema";

interface LeanCtxEditorProps {
  config: Record<string, unknown>;
  meta?: {
    globalPath: string;
    baselinePath: string;
    runtimeParseError?: string;
    baselineParseError?: string;
  };
  schema: LeanCtxSchemaEntry[];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function getInputType(entry: LeanCtxSchemaEntry): string {
  switch (entry.type) {
    case "boolean": return "checkbox";
    case "number": return "number";
    case "select": return "select";
    case "json": return "textarea";
    case "textarea": return "textarea";
    default: return "text";
  }
}

function renderInput(entry: LeanCtxSchemaEntry, value: unknown, disabled: boolean) {
  const inputType = getInputType(entry);
  const formattedValue = formatValue(value);
  const min = entry.min !== undefined ? `min="${entry.min}"` : "";
  const max = entry.max !== undefined ? `max="${entry.max}"` : "";
  const step = entry.type === "number" ? `step="any"` : "";
  const disabledAttr = disabled ? "disabled" : "";

  switch (inputType) {
    case "checkbox":
      return html`<input type="checkbox" value="true" ${value === true ? "checked" : ""} ${disabledAttr} oninput="markDirty()" onchange="markDirty()" />`;
    case "select":
      return html`<select ${disabledAttr} oninput="markDirty()" onchange="markDirty()">
        ${entry.options?.map((opt) => html`<option value=${opt} ${formattedValue === opt ? "selected" : ""}>${opt}</option>`)}
      </select>`;
    case "textarea":
      return html`<textarea ${disabledAttr} oninput="markDirty()" onchange="markDirty()" rows="4" style="font-family:monospace;font-size:0.85rem;width:100%;">${formattedValue}</textarea>`;
    default:
      return html`<input type="${inputType}" value="${formattedValue}" ${min} ${max} ${step} ${disabledAttr} oninput="markDirty()" onchange="markDirty()" style="width:100%;" />`;
  }
}

const LeanCtxEditorContent: FC<LeanCtxEditorProps> = ({ config, meta, schema }) => {
  const sections = getSchemaBySection(schema);

  return html`
    <div class="leanctx-editor">
      <div class="editor-header">
        <h1>LeanCTX Configuration</h1>
        <div class="editor-meta">
          ${meta && html`
            <span class="text-sm text-muted">
              Global: <code>${meta.globalPath}</code>
              | Baseline: <code>${meta.baselinePath}</code>
            </span>
          `}
        </div>
      </div>
      ${(meta?.runtimeParseError || meta?.baselineParseError) && html`
        <div class="config-error text-danger" role="alert">
          <strong>Configuration requires repair.</strong>
          ${meta.runtimeParseError || meta.baselineParseError}
          <span>Use Reset to Defaults to restore the baseline and repair the configuration.</span>
        </div>
      `}

      <div class="editor-actions" aria-label="Configuration actions">
        <button class="btn-primary" onclick="saveConfig()">Save Changes</button>
        <button class="btn-primary" onclick="validateConfig()">Validate Config</button>
        <button class="btn-apply" id="apply-config" onclick="applyConfig(event)" aria-describedby="apply-config-help">Apply Saved Config <span class="btn-subtext">(lean-ctx config apply)</span></button>
        <button class="btn-danger" onclick="resetConfig()">Reset to Defaults</button>
      </div>
      <p class="workflow-hint text-sm text-muted">
        Edit values, then select <strong>Save Changes</strong>. Apply runs <code>lean-ctx config apply</code> in ai-dev; the CLI restarts the LeanCTX daemon without recreating the container.
      </p>
      <p id="apply-config-help" class="action-help text-sm text-muted">Apply uses the saved configuration and runs lean-ctx config apply in ai-dev.</p>
      <p id="config-status" class="text-sm text-muted" aria-live="polite">Saved configuration loaded. Apply when ready; applying runs lean-ctx config apply in ai-dev.</p>

      <form id="config-form">
        ${Object.entries(sections).map(([sectionName, entries]) => html`
          <fieldset class="config-section">
            <legend>${sectionName}</legend>
            <table class="config-table">
              <thead>
                <tr>
                  <th style="width:30%">Key</th>
                  <th style="width:40%">Description</th>
                  <th style="width:30%">Value</th>
                </tr>
              </thead>
              <tbody>
                ${entries.map((entry) => {
                  const value = config[entry.key];
                  const isDefault = value === entry.default;
                  return html`
                    <tr data-key="${entry.key}" class="${isDefault ? "is-default" : ""}">
                      <td>
                        <code>${entry.key}</code>
                        ${entry.deprecated ? html`<span class="badge badge-warning" style="margin-left:0.5rem;font-size:0.65rem;">Deprecated</span>` : ""}
                      </td>
                      <td>
                        <span class="text-sm text-muted">${entry.description}</span>
                        ${entry.default !== undefined ? html`<br><span class="text-xs text-muted">Default: <code>${formatValue(entry.default)}</code></span>` : ""}
                      </td>
                      <td>
                        <div class="value-cell">
                          ${renderInput(entry, value, false)}
                          <div class="value-actions">
                            <button type="button" class="btn-icon" onclick="resetKey('${entry.key}')" title="Reset to default">↺</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </fieldset>
        `)}
      </form>

      <div id="validate-modal" class="modal-overlay" style="display:none;">
        <div class="modal">
          <div class="modal-header">
            <h3 id="result-modal-title">Validation Result</h3>
            <button class="btn-icon" onclick="closeValidateModal()">✕</button>
          </div>
          <div class="modal-body" id="validate-output"></div>
          <div class="modal-footer">
            <button class="btn-primary" onclick="closeValidateModal()">Close</button>
          </div>
        </div>
      </div>
    </div>

    <script>${html`
      let isDirty = false;
      let hasSavedConfig = true;

      function updateApplyState() {
        const btn = document.getElementById("apply-config");
        const help = document.getElementById("apply-config-help");
        if (!btn || !help) return;
        btn.disabled = isDirty || !hasSavedConfig;
        help.textContent = isDirty
          ? "Save Changes before applying. Apply runs lean-ctx config apply in ai-dev."
          : "Apply uses the saved configuration and runs lean-ctx config apply in ai-dev.";
      }

      function getFormData() {
        const form = document.getElementById("config-form");
        const data = {};
        for (const row of form.querySelectorAll("tr[data-key]")) {
          const key = row.dataset.key;
          const input = row.querySelector("input, select, textarea");
          if (!input) continue;
          let value = input.value;
          if (input.type === "checkbox") {
            value = input.checked;
          } else if (input.type === "number") {
            value = value === "" ? null : Number(value);
          } else if (input.tagName === "TEXTAREA") {
            try {
              value = JSON.parse(value);
            } catch {
              // keep as string
            }
          }
          if (value !== null && value !== "") {
            data[key] = value;
          }
        }
        return data;
      }

      async function saveConfig() {
        const btn = document.querySelector('button[onclick="saveConfig()"]');
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Saving...";
        }
        const config = getFormData();
        const res = await fetch("/api/leanctx/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        });
        if (res.ok) {
          isDirty = false;
          hasSavedConfig = true;
          updateApplyState();
          document.getElementById("config-status").textContent = "Saved. Apply when ready; applying runs lean-ctx config apply in ai-dev.";
        } else {
          const d = await res.json();
          alert(d.error || "Failed to save");
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Save Changes";
        }
      }

      async function validateConfig() {
        const config = getFormData();
        const res = await fetch("/api/leanctx/config/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        });
        const data = await res.json();
        const output = document.getElementById("validate-output");
        if (data.ok) {
          output.innerHTML = '<div class="text-success">✓ Configuration is valid</div>';
          if (data.warnings && data.warnings.length) {
            output.innerHTML += '<div class="text-warning mt-2">Warnings:<ul>' + data.warnings.map(w => '<li>' + w + '</li>').join('') + '</ul></div>';
          }
        } else {
          output.innerHTML = '<div class="text-danger">✗ Validation failed: ' + (data.error || "Unknown error") + '</div>';
        }
        document.getElementById("result-modal-title").textContent = "Validation Result";
        document.getElementById("validate-modal").style.display = "flex";
      }

      async function applyConfig(event) {
        if (isDirty || !hasSavedConfig) {
          alert("Save Changes before applying. Apply runs lean-ctx config apply in ai-dev.");
          return;
        }
        const btn = event.currentTarget;
        btn.disabled = true;
        btn.textContent = "Applying...";
        const res = await fetch("/api/leanctx/apply", { method: "POST" });
        const data = await res.json();
        btn.disabled = false;
        btn.innerHTML = 'Apply Saved Config <span class="btn-subtext">(lean-ctx config apply)</span>';
        const output = document.getElementById("validate-output");
        if (data.ok) {
          output.innerHTML = '<div class="text-success">✓ Saved configuration applied via lean-ctx config apply. The LeanCTX daemon was restarted by the CLI; the ai-dev container was not recreated.</div>';
        } else {
          output.replaceChildren();
          const error = document.createElement("div");
          error.className = "text-danger";
          error.textContent = "✗ Apply failed: " + (data.error || data.output || "Unknown error");
          output.append(error);
        }
        document.getElementById("result-modal-title").textContent = "Apply Result";
        document.getElementById("validate-modal").style.display = "flex";
      }

      async function resetConfig() {
        if (!confirm("Reset all visible values to the image baseline? This writes the baseline to config.toml immediately and repairs a malformed config.")) return;
        const res = await fetch("/api/leanctx/config/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await res.json();
        if (res.ok) {
          const baseline = data.config || {};
          for (const entry of ${raw(JSON.stringify(schema))}) {
            setInputValue(entry.key, baseline[entry.key] !== undefined ? baseline[entry.key] : entry.default);
          }
          isDirty = false;
          hasSavedConfig = true;
          updateApplyState();
          document.getElementById("config-status").textContent = "Baseline restored. Apply when ready; applying runs lean-ctx config apply in ai-dev.";
        } else {
          alert(data.error || "Failed to reset config");
        }
      }

      function setInputValue(key, value) {
        const row = document.querySelector('tr[data-key="' + key + '"]');
        const input = row?.querySelector("input, select, textarea");
        if (!input) return;
        if (input.type === "checkbox") {
          input.checked = value === true;
        } else if (value === undefined || value === null) {
          input.value = "";
        } else if (typeof value === "object") {
          input.value = JSON.stringify(value, null, 2);
        } else {
          input.value = String(value);
        }
      }

      function resetKey(key) {
        const entry = ${raw(JSON.stringify(schema))}.find(e => e.key === key);
        if (!entry || entry.default === undefined) return;
        setInputValue(key, entry.default);
        markDirty();
      }

      function markDirty() {
        isDirty = true;
        hasSavedConfig = true;
        updateApplyState();
        document.getElementById("config-status").textContent = "Unsaved changes. Save before applying.";
      }

      function closeValidateModal() {
        document.getElementById("validate-modal").style.display = "none";
      }

      document.querySelectorAll("#config-form input, #config-form select, #config-form textarea").forEach(input => {
        input.addEventListener("input", markDirty);
        input.addEventListener("change", markDirty);
      });

      updateApplyState();

      document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) {
            overlay.style.display = "none";
          }
        });
      });
    `}</script>

    <style>${html`
      .leanctx-editor { max-width: 1200px; margin: 0 auto; padding: 1rem; }
      .editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem; }
      .editor-header h1 { margin: 0; }
      .editor-meta { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
      .editor-actions { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
      .btn-apply { background: var(--warning); color: #18181b; }
      .btn-apply:hover { background: #fbbf24; }
      .btn-apply:disabled { background: var(--border); color: var(--text-muted); cursor: not-allowed; }
      .btn-subtext { font-size: 0.8em; opacity: 0.85; }
      .workflow-hint { margin: -0.5rem 0 1rem; }
      .action-help { margin: -0.5rem 0 0.5rem; }
      .config-error { margin-bottom: 1rem; padding: 0.75rem 1rem; border: 1px solid var(--danger); border-radius: 6px; background: var(--danger-bg); }
      .config-error span { display: block; margin-top: 0.25rem; }
      .config-section { margin-bottom: 2rem; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
      .config-section legend { padding: 0.5rem 1rem; background: var(--bg-secondary); border-bottom: 1px solid var(--border); font-weight: 600; }
      .config-table { width: 100%; border-collapse: collapse; }
      .config-table th { text-align: left; padding: 0.75rem 1rem; background: var(--bg-secondary); border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.85rem; }
      .config-table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }
      .config-table tr:last-child td { border-bottom: none; }
      .config-table tr.is-default td { opacity: 0.7; }
      .config-table code { background: var(--bg-tertiary); padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.85rem; }
      .value-cell { display: flex; align-items: center; gap: 0.5rem; }
      .value-actions { display: flex; gap: 0.25rem; }
      .btn-icon { padding: 0.25rem 0.5rem; font-size: 0.85rem; background: none; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; }
      .btn-icon:hover { background: var(--bg-tertiary); }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
      .modal { background: var(--bg); border-radius: 8px; padding: 1.5rem; min-width: 400px; max-width: 90vw; max-height: 90vh; overflow: auto; }
      .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
      .modal-header h3 { margin: 0; }
      .modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
      .text-success { color: var(--success); }
      .text-danger { color: var(--danger); }
      .text-warning { color: var(--warning); }
      .text-muted { color: var(--text-muted); }
      .text-sm { font-size: 0.85rem; }
      .text-xs { font-size: 0.75rem; }
      .mt-2 { margin-top: 0.5rem; }
      .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
      .badge-warning { background: var(--warning-bg); color: var(--warning); }
      pre { margin: 0; }
      @media (max-width: 768px) {
        .leanctx-editor { padding: 0; }
        .editor-header { flex-direction: column; align-items: stretch; gap: 0.5rem; }
        .editor-meta { display: block; }
        .editor-meta code, .workflow-hint, .action-help, #config-status { overflow-wrap: anywhere; }
        .editor-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
        .editor-actions button { min-width: 0; min-height: 44px; }
        .btn-subtext { display: block; }
        .config-section { margin-bottom: 1rem; }
        .config-table, .config-table tbody { display: block; }
        .config-table thead { display: none; }
        .config-table tr[data-key] { display: block; margin-bottom: 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
        .config-table td { display: block; padding: 0.75rem; border-bottom: 1px solid var(--border); }
        .config-table tr[data-key] td:last-child { border-bottom: none; }
        .config-table code { overflow-wrap: anywhere; }
        .value-cell { align-items: stretch; flex-direction: column; gap: 0.5rem; }
        .value-actions { justify-content: flex-end; }
        .value-actions .btn-icon { min-width: 44px; min-height: 44px; }
        .config-table input, .config-table select, .config-table textarea { box-sizing: border-box; width: 100%; min-height: 44px; font-size: 16px; }
        .config-table textarea { font-size: 16px !important; }
        .modal-overlay { align-items: flex-end; padding: 1rem; box-sizing: border-box; }
        .modal { min-width: 0; width: 100%; max-width: none; max-height: 80vh; padding: 1rem; }
      }
      .mobile .leanctx-editor { padding: 0; }
      .mobile .editor-header { flex-direction: column; align-items: stretch; gap: 0.5rem; }
      .mobile .editor-meta { display: block; }
      .mobile .editor-meta code, .mobile .workflow-hint, .mobile .action-help, .mobile #config-status { overflow-wrap: anywhere; }
      .mobile .editor-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
      .mobile .editor-actions button { min-width: 0; min-height: 44px; }
      .mobile .btn-subtext { display: block; }
      .mobile .config-section { margin-bottom: 1rem; }
      .mobile .config-table, .mobile .config-table tbody { display: block; }
      .mobile .config-table thead { display: none; }
      .mobile .config-table tr[data-key] { display: block; margin-bottom: 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
      .mobile .config-table td { display: block; padding: 0.75rem; border-bottom: 1px solid var(--border); }
      .mobile .config-table tr[data-key] td:last-child { border-bottom: none; }
      .mobile .config-table code { overflow-wrap: anywhere; }
      .mobile .value-cell { align-items: stretch; flex-direction: column; gap: 0.5rem; }
      .mobile .value-actions { justify-content: flex-end; }
      .mobile .value-actions .btn-icon { min-width: 44px; min-height: 44px; }
      .mobile .config-table input, .mobile .config-table select, .mobile .config-table textarea { box-sizing: border-box; width: 100%; min-height: 44px; font-size: 16px; }
      .mobile .config-table textarea { font-size: 16px !important; }
      .mobile .modal-overlay { align-items: flex-end; padding: 1rem; box-sizing: border-box; }
      .mobile .modal { min-width: 0; width: 100%; max-width: none; max-height: 80vh; padding: 1rem; }
    `}</style>
  `;
};

export function LeanCtxEditorPage(
  config: Record<string, unknown>,
  meta: LeanCtxEditorProps["meta"],
  schema: LeanCtxSchemaEntry[],
) {
  return (
    <Layout title="LeanCTX Config" currentPath="/leanctx">
      <LeanCtxEditorContent config={config} meta={meta} schema={schema} />
    </Layout>
  );
}
