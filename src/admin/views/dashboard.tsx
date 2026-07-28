import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Layout } from "./layout";

interface UpdateCheckResult {
  current: string;
  latest: string;
  update_available: boolean;
  status: "checking" | "up-to-date" | "update-available" | "check-failed";
  message: string;
}

interface UpgradeEvent {
  id: number;
  step: string;
  status: string;
  message: string;
  timestamp: string;
}

interface DashboardData {
  container_status: string;
  uptime_seconds: number | null;
  versions: Record<string, string>;
  gh_auth: string;
  glab_auth: string;
  git_user: string;
  project_count: number;
  update_check: UpdateCheckResult;
  upgrade_state: string;
  upgrade_events: UpgradeEvent[];
  upgrade_current_step: string;
  upgrade_progress_pct: number;
  admin_version: string;
  admin_version_mismatch: boolean;
}

const UpdateBadge: FC<{ check: UpdateCheckResult }> = ({ check }) => {
  if (check.status === "update-available") {
    return <span class="badge badge-warning" style="cursor:pointer;" onclick="startUpgrade()">▲ Upgrade</span>;
  }
  if (check.status === "check-failed") {
    return <span class="badge" style="background:rgba(139,143,163,0.15);color:var(--text-muted);font-size:0.65rem;">? unavailable</span>;
  }
  return <span class="badge badge-success" style="font-size:0.65rem;">✓ Latest</span>;
};

const DashboardContent: FC<{ data: DashboardData }> = ({ data }) => {
  const isRunning = data.container_status === "running";
  const isUpgrading = data.upgrade_state === "running";
  return (
    <div>
      <h2 style="margin-bottom:24px;">Dashboard</h2>
      {!isRunning && (
        <div class="card" style="border-color:var(--danger);margin-bottom:16px;">
          <strong class="text-danger">⚠ ai-dev container is not running</strong>
          <p class="text-sm text-muted mt-4">Some features (auth, SSH, git, projects, upgrade) are unavailable while ai-dev is down.</p>
        </div>
      )}
      <div class="grid-2">
        <div class="card">
          <h3>Container Status</h3>
          <div class="flex items-center gap-2">
            <span class={`badge ${isRunning ? "badge-success" : "badge-danger"}`}>{data.container_status}</span>
            {data.uptime_seconds != null && <span class="text-sm text-muted">Uptime: {Math.floor(data.uptime_seconds / 60)}m</span>}
          </div>
          {isRunning && (
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
              <div class="flex items-center gap-2">
                <span id="dash-restart-status" class="text-sm text-muted"></span>
                <button id="btn-dash-restart" onclick="dashRestartAiDev()" class="btn-outline" style="color:var(--danger);border-color:var(--danger);">↻ Restart ai-dev</button>
              </div>
            </div>
          )}
          {data.admin_version_mismatch && (
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
              <div class="flex items-center gap-2">
                <span class="text-sm">ai-admin</span>
                <span class="badge badge-warning" style="font-size:0.65rem;">⚠ {data.admin_version}</span>
                <button onclick="restartAdmin()" class="btn-outline" style="padding:2px 8px;font-size:0.7rem;color:var(--danger);border-color:var(--danger);">↻ Restart</button>
              </div>
              <p class="text-sm text-muted" style="margin-top:4px;">Admin container needs restart to match ai-dev version</p>
            </div>
          )}
        </div>
        <div class="card">
          <h3>Projects</h3>
          <p class="stat-number">{data.project_count}</p>
          <p class="text-sm text-muted">workspace projects</p>
        </div>
      </div>
      <div class="card">
        <h3>Auth Status</h3>
        <table>
          <tr><th>Service</th><th>Status</th></tr>
          <tr>
            <td>GitHub CLI</td>
            <td><span class={`badge ${data.gh_auth === "authenticated" ? "badge-success" : "badge-warning"}`}>{data.gh_auth}</span></td>
          </tr>
          <tr>
            <td>GitLab CLI</td>
            <td><span class={`badge ${data.glab_auth === "authenticated" ? "badge-success" : "badge-warning"}`}>{data.glab_auth}</span></td>
          </tr>
          <tr>
            <td>Git Config</td>
            <td><span class={`badge ${data.git_user ? "badge-success" : "badge-warning"}`}>{data.git_user || "not configured"}</span></td>
          </tr>
        </table>
      </div>
      <div class="card">
        <h3>Component Versions</h3>
        <table>
          <tr><th>Component</th><th>Version</th></tr>
          {Object.entries(data.versions).map(([name, version]) => (
            <tr>
              <td>{name}</td>
              <td>
                <code>{version}</code>
                {name === "AI-EngKit" && !isUpgrading && <span style="margin-left:8px;"><UpdateBadge check={data.update_check} /></span>}
                {name === "AI-EngKit" && isUpgrading && <span class="badge" style="background:rgba(99,102,241,0.15);color:var(--accent);margin-left:8px;">running</span>}
              </td>
            </tr>
          ))}
        </table>
        {isUpgrading && (
          <div id="upgrade-inline-progress" style="margin-top:12px;">
            <div class="progress-bar mb-4"><div class="fill" id="inline-progress-fill" style={`width:${data.upgrade_progress_pct}%;`} /></div>
            <div id="inline-log-viewer" class="log-viewer" style="max-height:200px;">
              {data.upgrade_events.map(e => (
                <div class="log-entry">
                  <span class="step">{e.step}</span>
                  <span class={`status ${e.status === 'success' ? 'text-success' : e.status === 'failure' ? 'text-danger' : ''}`}>{e.status}</span>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <script>{html`
        let inlineEventSource = null;
        let lastEventId = 0;
        async function startUpgrade() {
          if (!confirm("ai-dev will restart during this upgrade (2-3s downtime). Proceed?")) return;
          const res = await fetch("/api/upgrade", { method: "POST" });
          if (res.status === 409) {
            const data = await res.json();
            if (data.status && data.status.state === "running") {
              connectUpgradeSSE();
              return;
            }
            alert("Upgrade already in progress");
            return;
          }
          if (!res.ok) { alert("Failed to start upgrade"); return; }
          connectUpgradeSSE();
        }
        async function restartAdmin() {
          if (!confirm("Restart admin container? Dashboard will reload in ~3 seconds.")) return;
          const btn = event.target;
          btn.disabled = true;
          btn.textContent = "Restarting...";
          try {
            const res = await fetch("/api/admin/restart", { method: "POST" });
            if (res.ok) {
              const poll = setInterval(async () => {
                try {
                  const h = await fetch("/healthz");
                  if (h.ok) { clearInterval(poll); location.reload(); }
                } catch {}
              }, 1000);
            } else {
              alert("Failed to restart admin");
              btn.disabled = false;
              btn.textContent = "↻ Restart";
            }
          } catch (e) {
            alert("Error: " + e.message);
            btn.disabled = false;
            btn.textContent = "↻ Restart";
          }
        }
        async function dashRestartAiDev() {
          if (!confirm("Restart ai-dev container? This will briefly interrupt OpenCode and OpenChamber.")) return;
          var btn = document.getElementById("btn-dash-restart");
          var status = document.getElementById("dash-restart-status");
          if (!btn || !status) return;
          btn.disabled = true;
          status.textContent = "Restarting...";
          try {
            var res = await fetch("/api/env/restart", { method: "POST" });
            if (res.ok) {
              status.textContent = "Restarted ✔";
              setTimeout(function () { status.textContent = ""; btn.disabled = false; }, 3000);
            } else {
              var d = await res.json();
              status.textContent = "Error: " + (d.error || "unknown");
              btn.disabled = false;
            }
          } catch (e) {
            status.textContent = "Error: " + e.message;
            btn.disabled = false;
          }
        }
        function ensureProgressElements() {
          var card = document.querySelector(".card h3");
          if (!card) return null;
          var existing = document.getElementById("upgrade-inline-progress");
          if (existing) return existing;
          var container = document.createElement("div");
          container.id = "upgrade-inline-progress";
          container.style.marginTop = "12px";
          container.innerHTML = '<div class="progress-bar mb-4"><div class="fill" id="inline-progress-fill" style="width:0%;"></div></div><div id="inline-log-viewer" class="log-viewer" style="max-height:200px;"></div>';
          card.closest(".card").appendChild(container);
          return container;
        }
        function connectUpgradeSSE() {
          if (inlineEventSource) inlineEventSource.close();
          ensureProgressElements();
          inlineEventSource = new EventSource("/api/upgrade/log");
          inlineEventSource.onmessage = function(e) {
            try {
              const ev = JSON.parse(e.data);
              if (ev.id && ev.id <= lastEventId) return;
              lastEventId = ev.id;
              var logViewer = document.getElementById("inline-log-viewer");
              var fill = document.getElementById("inline-progress-fill");
              var progressCard = document.getElementById("upgrade-inline-progress");
              if (progressCard) progressCard.style.display = "block";
              if (logViewer) {
                var entry = document.createElement("div");
                entry.className = "log-entry";
                entry.innerHTML = '<span class="step">' + ev.step + '</span>' +
                  '<span class="status ' + (ev.status === 'success' ? 'text-success' : ev.status === 'failure' ? 'text-danger' : '') + '">' + ev.status + '</span>' +
                  '<span>' + (ev.message || '') + '</span>';
                logViewer.appendChild(entry);
                logViewer.scrollTop = logViewer.scrollHeight;
              }
              var steps = ["digest_compare","backup","merge_env","recreate","poll_health","cleanup"];
              var idx = steps.indexOf(ev.step);
              if (idx >= 0 && (ev.status === 'success' || ev.status === 'failure')) {
                var pct = Math.round(((idx + 1) / steps.length) * 100);
                if (fill) fill.style.width = pct + "%";
              }
              if (ev.step === "cleanup" && ev.status === "success") {
                setTimeout(function() { location.reload(); }, 2000);
              }
              if (ev.step === "cleanup" && ev.status === "failure") {
                if (inlineEventSource) inlineEventSource.close();
              }
            } catch(_) {}
          };
          inlineEventSource.onerror = function() {
            /* reconnect automatically */
          };
        }
        var us = document.getElementById("upgrade-inline-progress");
        if (us && us.style.display !== "none") {
          connectUpgradeSSE();
        }
      `}</script>
    </div>
  );
};

export function DashboardPage(data: DashboardData) {
  return (
    <Layout title="Dashboard" currentPath="/">
      <DashboardContent data={data} />
    </Layout>
  );
}
