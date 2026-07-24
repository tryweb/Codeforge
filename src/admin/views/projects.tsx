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
      <table>
        <tr><th>Name</th><th></th></tr>
        {projects.map(name => (
          <tr><td><code>{name}</code></td><td><button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick={`initProject('${name}')`}>Init OpenCode</button></td></tr>
        ))}
        {projects.length === 0 && <tr><td colspan="2" class="text-muted">No projects yet</td></tr>}
      </table>
    </div>
    <div id="create-modal" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3>Create New Project</h3>
        <div class="form-group">
          <label for="project-name">Project Name</label>
          <input type="text" id="project-name" placeholder="my-project" />
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="init-opencode" checked /> Initialize with OpenCode</label>
        </div>
        <div id="create-error" class="text-sm text-danger" style="display:none;margin-bottom:8px;" />
        <div class="flex gap-2" style="justify-content:flex-end;">
          <button class="btn-outline" onclick="closeCreate()">Cancel</button>
          <button onclick="createProject()">Create</button>
        </div>
      </div>
    </div>
    <script>{html`
      function showCreateForm() { document.getElementById("create-modal").style.display = "flex"; }
      function closeCreate() { document.getElementById("create-modal").style.display = "none"; }
      async function createProject() {
        const name = document.getElementById("project-name").value.trim();
        const initOpenCode = document.getElementById("init-opencode").checked;
        if (!name) return;
        const res = await fetch("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, init_opencode: initOpenCode }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); document.getElementById("create-error").style.display = "block";
          document.getElementById("create-error").textContent = d.error || "Failed to create"; }
      }
      async function initProject(name) {
        if (!confirm("Initialize " + name + " with OpenCode?")) return;
        const res = await fetch("/api/projects/" + encodeURIComponent(name) + "/init", { method: "POST" });
        if (res.ok) { alert("Project initialized!"); } else { alert("Failed to initialize"); }
      }
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
