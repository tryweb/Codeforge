import { html } from "hono/html";
import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const ProjectsContent: FC<{ projects: string[] }> = ({ projects }) => (
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2>OpenCode Projects</h2>
      <div class="flex gap-2">
        <button onclick="syncProjects()" class="btn-outline">↻ Sync</button>
        <button id="btn-tool-refresh" onclick="refreshToolStatus()" class="btn-outline">⟳ Re-scan</button>
        <button onclick="showCreateForm()" class="btn-outline">+ New Project</button>
      </div>
    </div>
    <div id="sync-modal" class="modal-overlay" style="display:none;">
      <div class="modal">
        <h3>Project Sync</h3>
        <div id="sync-status" class="text-sm" style="margin-bottom:8px;">Checking...</div>
        <div id="sync-results" style="display:none;"></div>
        <div id="sync-actions" style="display:none;justify-content:flex-end;margin-top:12px;gap:8px;" class="flex">
          <button class="btn-outline" onclick="closeSync()">Cancel</button>
          <button id="btn-sync-fix" onclick="applySync()">Fix All</button>
        </div>
      </div>
    </div>
    <div class="card">
      <table id="projects-table">
        <tr><th>Name</th><th class="text-center">Knowledge</th><th class="text-center">Maintenance</th><th class="text-center">OpenSpec</th><th class="text-center">CodeGraph</th></tr>
        {projects.map(name => (
          <tr data-project={name}>
            <td><code>{name}</code></td>
            <td class="feat-cell text-center" data-feat="knowledge"><span class="text-muted">...</span></td>
            <td class="feat-cell text-center" data-feat="maintenance"><span class="text-muted">...</span></td>
            <td class="feat-cell text-center" data-feat="openspec"><span class="text-muted">...</span></td>
            <td class="tool-cell text-center" data-tool="codegraph"><span class="text-muted">...</span></td>
          </tr>
        ))}
        {projects.length === 0 && <tr><td colspan="5" class="text-muted">No projects yet</td></tr>}
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
          <label><input type="checkbox" id="init-git" checked onchange="toggleGitRemote()" /> Initialize with git</label>
        </div>
        <div class="form-group" id="git-remote-group" style="display:block;">
          <label for="git-remote">Git Remote URL <span class="text-sm text-muted">(optional)</span></label>
          <input type="text" id="git-remote" placeholder="https://github.com/your-org/project.git" />
        </div>
        <div id="create-error" class="text-sm text-danger" style="display:none;margin-bottom:8px;" />
        <div class="flex gap-2" style="justify-content:flex-end;">
          <button class="btn-outline" onclick="closeCreate()">Cancel</button>
          <button onclick="createProject()">Create</button>
        </div>
      </div>
    </div>
    <script>{html`
      function formatWhen(value) {
        const t = new Date(value);
        if (isNaN(t.getTime())) return value;
        const diff = Date.now() - t.getTime();
        if (diff < 0) return "now";
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return mins + "m ago";
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + "h ago";
        const days = Math.floor(hours / 24);
        if (days < 30) return days + "d ago";
        return t.toISOString().slice(0, 10);
      }

      function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      }

      async function loadFeatures() {
        const rows = document.querySelectorAll("#projects-table tr[data-project]");
        const res = await fetch("/api/projects/overview").then(r => r.json()).catch(() => null);
        if (!res) {
          rows.forEach(row => row.querySelectorAll(".feat-cell").forEach(cell => cell.innerHTML = '<span class="text-muted">err</span>'));
          return;
        }
        rows.forEach(row => {
          const name = row.getAttribute("data-project");
          const data = res[name];
          if (!data) return;

          row.querySelectorAll(".feat-cell").forEach(cell => {
            const f = cell.getAttribute("data-feat");
            const enabled = data.features && data.features[f];
            if (enabled) {
              cell.innerHTML = '<span class="badge badge-success" style="font-size:0.85rem;">&#10003;</span>';
            } else {
              cell.innerHTML = '<button class="btn-outline" style="padding:2px 8px;font-size:0.75rem;" onclick="event.stopPropagation();enableFeature(this)">Enable</button>';
            }
          });

          row.querySelectorAll(".tool-cell").forEach(cell => {
            const status = data.codegraph;
            if (!status) {
              cell.innerHTML = '<span class="text-muted">unknown</span>';
            } else if (status.initialized) {
              const parts = [];
              if (typeof status.lastIndexed === "string") parts.push("last indexed " + formatWhen(status.lastIndexed));
              if (typeof status.fileCount === "number") parts.push(status.fileCount.toLocaleString() + " files");
              if (typeof status.nodeCount === "number") parts.push(status.nodeCount.toLocaleString() + " nodes");
              if (typeof status.edgeCount === "number") parts.push(status.edgeCount.toLocaleString() + " edges");
              if (status.index && status.index.reindexRecommended) parts.push("reindex recommended");
              if (status.index && typeof status.index.state === "string") parts.push("state: " + status.index.state);
              cell.innerHTML = '<span class="badge badge-success" style="font-size:0.85rem;" title="' + parts.map(escapeHtml).join("&#10;") + '">&#10003;</span>';
            } else {
              cell.innerHTML = '<span class="badge" style="font-size:0.75rem;color:var(--text-muted);">not indexed</span>';
            }
          });

          const nameCell = row.querySelector("td:first-child");
          const existing = nameCell.querySelector(".git-remote-info");
          if (existing) existing.remove();
          const info = document.createElement("span");
          info.className = "git-remote-info";
          info.style.cssText = "display:block;font-size:0.75rem;margin-top:2px;";
          if (data.remote) {
            const short = data.remote.length > 50 ? data.remote.substring(0, 47) + "..." : data.remote;
            info.innerHTML = '<span class="text-muted" style="cursor:pointer;" onclick="setGitRemote(this)" title="' + data.remote.replace(/"/g, '&quot;') + '">&#128279; ' + short + '</span>';
          } else {
            info.innerHTML = '<span class="text-muted" style="cursor:pointer;" onclick="setGitRemote(this)">[set remote]</span>';
          }
          nameCell.appendChild(info);
          const disabled = !!data.disabled;
          const existingState = nameCell.querySelector(".state-wrap");
          if (existingState) existingState.remove();
          const stateWrap = document.createElement("span");
          stateWrap.className = "state-wrap";
          stateWrap.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:2px;";
          if (disabled) {
            const badge = document.createElement("span");
            badge.className = "badge badge-warning";
            badge.style.fontSize = "0.75rem";
            badge.textContent = "Disabled";
            stateWrap.appendChild(badge);
          }
          const toggle = document.createElement("button");
          toggle.className = "btn-outline";
          toggle.style.cssText = "padding:2px 8px;font-size:0.75rem;";
          toggle.textContent = disabled ? "Enable" : "Disable";
          toggle.title = "Show or hide this project in OpenChamber. Project files are never deleted.";
          toggle.onclick = () => toggleProjectState(name, disabled);
          stateWrap.appendChild(toggle);
          nameCell.appendChild(stateWrap);
        });
      }

      let refreshBusy = false;
      async function refreshToolStatus() {
        if (refreshBusy) return;
        refreshBusy = true;
        const btn = document.getElementById("btn-tool-refresh");
        if (btn) { btn.disabled = true; btn.textContent = "Scanning..."; }
        try {
          await fetch("/api/projects/tool-status/refresh", { method: "POST" });
          await loadFeatures();
        } catch (e) {
          if (btn) { btn.textContent = "Error"; }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "⟳ Re-scan"; }
          refreshBusy = false;
        }
      }

      async function setGitRemote(el) {
        const row = el.closest("tr[data-project]");
        const name = row.getAttribute("data-project");
        const current = el.title || "";
        const url = prompt("Git remote URL" + (current ? " (leave empty to remove):" : ":"), current || "");
        if (url === null) return;
        const res = await fetch("/api/projects/" + encodeURIComponent(name) + "/git-remote", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remote: url }),
        });
        if (res.ok) { location.reload(); }
        else {
          let msg = "Failed to set remote";
          try { const d = await res.json(); msg = d.error || msg; } catch (e) { msg = res.status + " " + res.statusText; }
          alert(msg);
        }
      }

      async function toggleProjectState(name, currentlyDisabled) {
        const action = currentlyDisabled ? "enable" : "disable";
        const res = await fetch("/api/projects/" + encodeURIComponent(name) + "/" + action, { method: "POST" });
        if (res.ok) { location.reload(); return; }
        let msg = "Failed to " + action;
        try { const d = await res.json(); msg = d.error || msg; } catch (e) { msg = res.status + " " + res.statusText; }
        alert(msg);
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

      function toggleGitRemote() {
        const show = document.getElementById("init-git").checked;
        document.getElementById("git-remote-group").style.display = show ? "block" : "none";
      }
      function showCreateForm() { document.getElementById("create-modal").style.display = "flex"; }
      function closeCreate() { document.getElementById("create-modal").style.display = "none"; }
      async function createProject() {
        const name = document.getElementById("project-name").value.trim();
        if (!name) return;
        const gitInit = document.getElementById("init-git").checked;
        const gitRemote = document.getElementById("git-remote").value.trim();
        const res = await fetch("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, git_init: gitInit, git_remote: gitRemote || undefined }),
        });
        if (res.ok) { location.reload(); }
        else { const d = await res.json(); document.getElementById("create-error").style.display = "block";
          document.getElementById("create-error").textContent = d.error || "Failed to create"; }
      }

      let syncData = null;
      async function syncProjects() {
        document.getElementById("sync-modal").style.display = "flex";
        document.getElementById("sync-status").textContent = "Checking...";
        document.getElementById("sync-results").style.display = "none";
        document.getElementById("sync-actions").style.display = "none";
        const res = await fetch("/api/projects/sync").then(r => r.json());
        syncData = res;
        const results = document.getElementById("sync-results");
        results.style.display = "block";
        let html = "";
        if (res.missingInOC && res.missingInOC.length > 0) {
          html += "<p><strong>Missing in OpenChamber</strong> (will be added):</p><ul>";
          res.missingInOC.forEach(n => { html += "<li><code>" + n + "</code></li>"; });
          html += "</ul>";
        }
        if (res.staleInOC && res.staleInOC.length > 0) {
          html += "<p><strong>Stale in OpenChamber</strong> (will be removed):</p><ul>";
          res.staleInOC.forEach(n => { html += "<li><code>" + n + "</code></li>"; });
          html += "</ul>";
        }
        if (!html) {
          document.getElementById("sync-status").textContent = "All projects are in sync.";
          document.getElementById("sync-actions").style.display = "flex";
          document.getElementById("btn-sync-fix").style.display = "none";
          return;
        }
        results.innerHTML = html;
        document.getElementById("sync-status").textContent = res.missingInOC.length + " missing, " + res.staleInOC.length + " stale.";
        document.getElementById("sync-actions").style.display = "flex";
      }
      async function applySync() {
        const btn = document.getElementById("btn-sync-fix");
        btn.disabled = true;
        btn.textContent = "Syncing...";
        const res = await fetch("/api/projects/sync", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add: syncData.missingInOC, remove: syncData.staleInOC }),
        }).then(r => r.json());
        if (res.ok) { location.reload(); }
        else { alert("Sync failed"); btn.disabled = false; btn.textContent = "Fix All"; }
      }
      function closeSync() { document.getElementById("sync-modal").style.display = "none"; }
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
