import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const EnvEditorContent: FC<{ envVars: Record<string, string>; envSchema: Array<{ key: string; type: string; description: string }> }> = ({ envVars, envSchema }) => (
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2>Environment Variables</h2>
      <button onclick="addVariable()" class="btn-outline">+ Add Variable</button>
    </div>
    <div class="card">
      <table id="env-table">
        <tr><th>Key</th><th>Value</th><th></th></tr>
        {Object.entries(envVars).map(([key, value]) => {
          const schema = envSchema.find(s => s.key === key);
          const isSecret = key.toLowerCase().includes("password") || key.toLowerCase().includes("secret") || key.toLowerCase().includes("token");
          return (
            <tr data-key={key}>
              <td><code>{key}</code><br /><span class="text-sm text-muted">{schema?.description || ""}</span></td>
              <td>
                <div class={"masked-value" + (isSecret ? "" : " show")} data-key={key}>
                  <span class="masked">••••••••</span>
                  <span class="revealed"><code>{value}</code></span>
                  {isSecret && <button class="btn-outline" style="padding:2px 8px;font-size:0.75rem;margin-left:8px;" onclick={`toggleMask('${key}')`}>Show</button>}
                </div>
              </td>
              <td><button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick={`editVar('${key}', '${value}')`}>Edit</button></td>
            </tr>
          );
        })}
      </table>
    </div>
    <div id="edit-modal" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3 id="modal-title">Edit Variable</h3>
        <div class="form-group"><label>Key</label><input type="text" id="edit-key" readonly /></div>
        <div class="form-group"><label>Value</label><input type="text" id="edit-value" /></div>
        <div class="flex gap-2" style="justify-content:flex-end;">
          <button class="btn-outline" onclick="closeModal()">Cancel</button>
          <button onclick="saveVar()">Save</button>
        </div>
      </div>
    </div>
    <script>{`
      function toggleMask(key) {
        const el = document.querySelector('.masked-value[data-key="' + key + '"]');
        el.classList.toggle("show");
        el.querySelector("button").textContent = el.classList.contains("show") ? "Hide" : "Show";
      }
      function editVar(key, value) {
        document.getElementById("edit-key").value = key;
        document.getElementById("edit-value").value = value;
        document.getElementById("edit-modal").style.display = "flex";
      }
      function closeModal() { document.getElementById("edit-modal").style.display = "none"; }
      async function saveVar() {
        const key = document.getElementById("edit-key").value;
        const value = document.getElementById("edit-value").value;
        const res = await fetch("/api/env/" + encodeURIComponent(key), {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); alert(d.error || "Failed to save"); }
      }
      function addVariable() {
        const key = prompt("Enter variable name:");
        if (!key) return;
        const value = prompt("Enter variable value:");
        if (value === null) return;
        fetch("/api/env/" + encodeURIComponent(key), {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        }).then(r => { if (r.ok) location.reload(); else alert("Failed"); });
      }
    `}</script>
  </div>
);

export function EnvEditorPage(envVars: Record<string, string>, envSchema: Array<{ key: string; type: string; description: string }>) {
  return (
    <Layout title="Environment" currentPath="/env">
      <EnvEditorContent envVars={envVars} envSchema={envSchema} />
    </Layout>
  );
}
