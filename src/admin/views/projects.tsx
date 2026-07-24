import { html } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const ProjectsContent: FC<{ projects: string[] }> = ({ projects }) => (
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2>OpenCode Projects</h2>
      <button onclick="showCreateForm()" class="btn-outline">+ New Project</button>
    </div>
    <div class="card">
      <table id="projects-table">
        <tr><th>Name</th><th>Knowledge</th><th>Maintenance</th><th>OpenSpec</th></tr>
        {projects.map(name => (
          <tr data-project={name}>
            <td><code>{name}</code></td>
            <td class="feat-cell" data-feat="knowledge"><span class="text-muted">...</span></td>
            <td class="feat-cell" data-feat="maintenance"><span class="text-muted">...</span></td>
            <td class="feat-cell" data-feat="openspec"><span class="text-muted">...</span></td>
          </tr>
        ))}
        {projects.length === 0 && <tr><td colspan="4" class="text-muted">No projects yet</td></tr>}
      </table>
    </div>
    <div id="create-modal" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3>Create New Project</h3>
        <div class="form-group">
          <label for="project-name">Project Name</label>
          <input type="text" id="project-name" placeholder="my-project" />
        </div>
        <div id="create-error" class="text-sm text-danger" style="display:none;margin-bottom:8px;" />
        <div class="flex gap-2" style="justify-content:flex-end;">
          <button class="btn-outline" onclick="closeCreate()">Cancel</button>
          <button onclick="createProject()">Create</button>
        </div>
      </div>
    </div>
    <script>{html`
      async function loadFeatures() {
        const rows = document.querySelectorAll("#projects-table tr[data-project]");
        const names = Array.from(rows).map(r => r.getAttribute("data-project"));
        const results = await Promise.allSettled(
          names.map(name =>
            fetch("/api/projects/" + encodeURIComponent(name) + "/features").then(r => r.json())
          )
        );
        rows.forEach((row, i) => {
          const r = results[i];
          const feats = r.status === "fulfilled" && r.value ? r.value : null;
          if (!feats || feats.error) {
            row.querySelectorAll(".feat-cell").forEach(cell => cell.innerHTML = '<span class="text-muted">err</span>');
            return;
          }
          row.querySelectorAll(".feat-cell").forEach(cell => {
            const f = cell.getAttribute("data-feat");
            const enabled = feats[f];
            if (enabled) {
              cell.innerHTML = '<span class="badge badge-success" style="font-size:0.85rem;">&#10003;</span>';
            } else {
              cell.innerHTML = '<button class="btn-outline" style="padding:2px 8px;font-size:0.75rem;" onclick="event.stopPropagation();enableFeature(this)">Enable</button>';
            }
          });
        });
      }

      async function enableFeature(btn) {
        const row = btn.closest("tr[data-project]");
        const name = row.getAttribute("data-project");
        const feat = btn.closest(".feat-cell").getAttribute("data-feat");
        btn.disabled = true;
        btn.textContent = "Enabling...";
        try {
          const res = await fetch("/api/projects/" + encodeURIComponent(name) + "/features/" + feat, { method: "POST" });
          if (res.ok) {
            btn.outerHTML = '<span class="badge badge-success" style="font-size:0.85rem;">&#10003;</span>';
          } else {
            const d = await res.json();
            btn.textContent = "Error";
            setTimeout(() => { btn.disabled = false; btn.textContent = "Enable"; }, 3000);
          }
        } catch (e) {
          btn.textContent = "Error";
          setTimeout(() => { btn.disabled = false; btn.textContent = "Enable"; }, 3000);
        }
      }

      function showCreateForm() { document.getElementById("create-modal").style.display = "flex"; }
      function closeCreate() { document.getElementById("create-modal").style.display = "none"; }
      async function createProject() {
        const name = document.getElementById("project-name").value.trim();
        if (!name) return;
        const res = await fetch("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); document.getElementById("create-error").style.display = "block";
          document.getElementById("create-error").textContent = d.error || "Failed to create"; }
      }

      loadFeatures();
    `}</script>
  </div>
);

export function ProjectsPage(projects: string[]) {
  return (
    <Layout title="Projects" currentPath="/projects">
      <ProjectsContent projects={projects} />
    </Layout>
  );
}
