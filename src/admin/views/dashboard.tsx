import type { FC } from "hono/jsx";
import { html } from "hono/html";
import { Layout } from "./layout";
import type { GainStats, LeanCtxSiteStats, ProveReportStats, SavingsReportStats, ValueReportStats } from "../lib/project-tool-status";

interface UpdateCheckResult {
  current: string;
  latest: string;
  update_available: boolean;
  status: "checking" | "up-to-date" | "update-available" | "check-failed" | "pinned";
  configured: string | null;
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
  leanctx: LeanCtxSiteStats | null;
  gain: GainStats | null;
  valueReport: ValueReportStats | null;
  proveReport: ProveReportStats | null;
  savingsReport: SavingsReportStats | null;
  update_check: UpdateCheckResult;
  upgrade_state: string;
  upgrade_events: UpgradeEvent[];
  upgrade_current_step: string;
  upgrade_progress_pct: number;
  admin_version: string;
  admin_version_mismatch: boolean;
}

const UpdateBadge: FC<{ check: UpdateCheckResult }> = ({ check }) => {
  if (check.status === "pinned") {
    return <span class="badge" style="background:rgba(99,102,241,0.15);color:var(--accent);font-size:0.65rem;">● Pinned {check.configured || check.current}</span>;
  }
  if (check.status === "update-available") {
    return <span class="badge badge-warning" style="cursor:pointer;" onclick="startUpgrade()">▲ Upgrade</span>;
  }
  if (check.status === "check-failed") {
    return <span class="badge" style="background:rgba(139,143,163,0.15);color:var(--text-muted);font-size:0.65rem;">? unavailable</span>;
  }
  return <span class="badge badge-success" style="font-size:0.65rem;">✓ Latest</span>;
};

type PillTone = "success" | "danger" | "warning" | "neutral";

/** Reusable status pill — tone maps to .status-pill--{tone}; ariaLabel for glyph-only labels. */
const StatusPill: FC<{ tone: PillTone; label: string; ariaLabel?: string }> = ({ tone, label, ariaLabel }) => (
  <span class={`status-pill status-pill--${tone}`} aria-label={ariaLabel}>{label}</span>
);

/** Reusable overview metric card — dl/dt/dd semantics; optional accent tone for the headline metric. */
const MetricCard: FC<{
  title: string;
  value: string;
  sub?: string;
  foot?: string;
  tone?: "default" | "accent";
}> = ({ title, value, sub, foot, tone = "default" }) => (
  <dl class={`metric-card${tone === "accent" ? " metric-card--accent" : ""}`}>
    <dt class="metric-card__title">{title}</dt>
    <dd class="metric-card__value">{value}</dd>
    {sub && <dd class="metric-card__sub">{sub}</dd>}
    {foot && <dd class="metric-card__foot">{foot}</dd>}
  </dl>
);

const DashboardContent: FC<{ data: DashboardData }> = ({ data }) => {
  const isRunning = data.container_status === "running";
  const isUpgrading = data.upgrade_state === "running";
  const { gain, leanctx, valueReport, proveReport, savingsReport } = data;
  const uptime = data.uptime_seconds != null ? `${Math.floor(data.uptime_seconds / 60)}m` : null;
  return (
    <div>
      <h2 style="margin-bottom:16px;">Dashboard</h2>

      <section class="site-summary" aria-label="Site summary">
        <span class="site-summary__item">
          <StatusPill tone={isRunning ? "success" : "danger"} label={data.container_status} />
          {uptime && <span class="site-summary__value">{uptime} uptime</span>}
        </span>
        <span class="site-summary__item">
          <span class="site-summary__label">Projects</span>
          <strong class="site-summary__value">{data.project_count}</strong>
        </span>
        <span class="site-summary__item">
          <span class="site-summary__label">GitHub</span>
          <StatusPill tone={data.gh_auth === "authenticated" ? "success" : "warning"} label={data.gh_auth === "authenticated" ? "✓" : "✗"} ariaLabel={`GitHub ${data.gh_auth}`} />
        </span>
        <span class="site-summary__item">
          <span class="site-summary__label">GitLab</span>
          <StatusPill tone={data.glab_auth === "authenticated" ? "success" : "warning"} label={data.glab_auth === "authenticated" ? "✓" : "✗"} ariaLabel={`GitLab ${data.glab_auth}`} />
        </span>
        <span class="site-summary__item">
          <span class="site-summary__label">Git</span>
          <span class={`site-summary__value${data.git_user ? "" : " text-muted"}`}>{data.git_user || "not configured"}</span>
        </span>
        {data.admin_version_mismatch && (
          <span class="site-summary__item">
            <StatusPill tone="warning" label={`⚠ ${data.admin_version}`} ariaLabel="Admin container version mismatch" />
          </span>
        )}
        <span class="site-summary__item">
          <UpdateBadge check={data.update_check} />
        </span>
      </section>

      {!isRunning && (
        <div class="card" style="border-color:var(--danger);margin-bottom:16px;">
          <strong class="text-danger">⚠ ai-dev container is not running</strong>
          <p class="text-sm text-muted mt-4">Some features (auth, SSH, git, projects, upgrade) are unavailable while ai-dev is down.</p>
        </div>
      )}

      <section class="metric-row" aria-label="Overview metrics">
        <MetricCard
          title="Token Savings"
          tone="accent"
          value={gain ? gain.netTokensSaved.toLocaleString() : "—"}
          sub={gain ? `$${gain.netUsdSaved.toFixed(2)} net saved` : "unavailable"}
          foot={gain ? `${gain.compressionPct.toFixed(1)}% compression` : undefined}
        />
        <MetricCard
          title="leanCTX Memory"
          value={leanctx ? leanctx.totalMemoryFacts.toLocaleString() : "—"}
          sub={leanctx ? `${leanctx.projectsWithFacts} projects with facts` : "unavailable"}
          foot={leanctx ? `${leanctx.healthCoverage} projects with health score` : undefined}
        />
        <MetricCard
          title="leanCTX Activity"
          value={leanctx ? String(leanctx.activeProjects24h) : "—"}
          sub={leanctx ? "active in last 24h" : "unavailable"}
          foot={gain ? (gain.ledgerVerified ? `✓ ledger intact · ${gain.ledgerEvents.toLocaleString()} events` : "⚠ ledger unverified") : undefined}
        />

      </section>

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
              <button onclick="restartAdmin(event)" class="btn-outline" style="padding:2px 8px;font-size:0.7rem;color:var(--danger);border-color:var(--danger);">↻ Restart</button>
              </div>
              <p class="text-sm text-muted" style="margin-top:4px;">Admin container needs restart to match ai-dev version</p>
            </div>
          )}
        </div>
        <div class="card">
          <h3>Projects</h3>
          <p class="stat-number">{data.project_count}</p>
          <p class="text-sm text-muted">workspace projects</p>
          {data.leanctx ? (
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span class="text-sm text-muted">projects with leanCTX facts</span>
                <span class="badge" style="font-size:0.8rem;">{data.leanctx.projectsWithFacts}</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span class="text-sm text-muted">total memory facts</span>
                <span class="badge" style="font-size:0.8rem;">{data.leanctx.totalMemoryFacts.toLocaleString()}</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span class="text-sm text-muted">active in last 24h</span>
                <span class="badge" style="font-size:0.8rem;">{data.leanctx.activeProjects24h}</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <span class="text-sm text-muted">projects with health score</span>
                <span class="badge" style="font-size:0.8rem;">{data.leanctx.healthCoverage}</span>
              </div>
            </div>
          ) : (
            <p class="text-sm text-muted" style="margin-top:12px;">leanCTX statistics unavailable</p>
          )}
        </div>
      </div>
      <div class="card">
        <h3>Token Savings <span class="text-sm text-muted">· leanCTX</span></h3>
        {data.gain ? (
          <div>
            <div class="dashboard-token-summary flex items-center gap-2" style="margin-bottom:12px;">
              <span class="stat-number">{data.gain.netTokensSaved.toLocaleString()}</span>
              <span class="text-sm text-muted">tokens net saved</span>
              <span class="badge badge-success" style="font-size:0.8rem;">{data.gain.compressionPct.toFixed(1)}% compression</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span class="text-sm text-muted">gross saved</span>
              <span class="text-sm">${data.gain.grossUsdSaved.toFixed(2)} ({data.gain.tokensSaved.toLocaleString()} tokens)</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span class="text-sm text-muted">stream overhead</span>
              <span class="text-sm">${data.gain.overheadUsd.toFixed(2)} ({data.gain.bounceTokens.toLocaleString()} bounce tokens)</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span class="text-sm text-muted">net saved</span>
              <span class="text-sm">${data.gain.netUsdSaved.toFixed(2)}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid var(--border);">
              <span class="text-sm text-muted">savings ledger</span>
              {data.gain.ledgerVerified ? (
                <span class="badge badge-success" style="font-size:0.8rem;">✓ SHA-256 chain intact · {data.gain.ledgerEvents.toLocaleString()} events</span>
              ) : (
                <span class="badge badge-warning" style="font-size:0.8rem;">⚠ chain unverified</span>
              )}
            </div>
          </div>
        ) : (
          <p class="text-sm text-muted">Token savings unavailable</p>
        )}
      </div>
      <div class="card">
        <h3>Decision Loop <span class="text-sm text-muted">· value report</span></h3>
        {valueReport ? (
          valueReport.tasks.length > 0 ? (
            <div class="flex items-center gap-2" style="flex-wrap:wrap;">
              <span class="badge badge-success" style="font-size:0.8rem;">{valueReport.totalTasks} tasks assessed</span>
              <span class="badge" style="font-size:0.8rem;">{(valueReport.acceptedRate <= 1 ? valueReport.acceptedRate * 100 : valueReport.acceptedRate).toFixed(0)}% acceptance</span>
              <span class="badge" style="font-size:0.8rem;">CPAO {valueReport.cpaoMicros}μs</span>
              <span class="badge" style="font-size:0.8rem;">ETPAO {valueReport.etpaoTokens.toLocaleString()} tokens</span>
              <span class="badge" style="font-size:0.8rem;">${valueReport.savingsUsd.toFixed(2)} saved</span>
            </div>
          ) : (
            <p class="text-sm text-muted">No assessments recorded yet</p>
          )
        ) : (
          <p class="text-sm text-muted">Decision Loop data unavailable</p>
        )}
      </div>
      <div class="card">
        <h3>Evidence Chain <span class="text-sm text-muted">· prove report</span></h3>
        {proveReport ? (
          proveReport.tasks.length > 0 ? (
            <div class="flex items-center gap-2" style="flex-wrap:wrap;">
              <span class="badge badge-success" style="font-size:0.8rem;">{proveReport.totalTasks} tasks proven</span>
              <span class="badge" style="font-size:0.8rem;">{(proveReport.acceptedRate <= 1 ? proveReport.acceptedRate * 100 : proveReport.acceptedRate).toFixed(0)}% accepted</span>
              <span class={`badge ${proveReport.evidenceChainComplete ? "badge-success" : "badge-warning"}`} style="font-size:0.8rem;">
                {proveReport.evidenceChainComplete ? "✓ chain complete" : "⚠ chain incomplete"}
              </span>
              <span class="badge" style="font-size:0.8rem;">ledger {proveReport.ledger.itemCount} items</span>
            </div>
          ) : (
            <p class="text-sm text-muted">No evidence data</p>
          )
        ) : (
          <p class="text-sm text-muted">Evidence Chain data unavailable</p>
        )}
      </div>
      <div class="card">
        <h3>Savings by Tool <span class="text-sm text-muted">· savings report</span></h3>
        {savingsReport ? (
          savingsReport.topSources.length > 0 ? (
            <table>
              <tr><th>Tool</th><th>Tokens saved</th><th>Share</th></tr>
              {savingsReport.topSources.map(([name, tokens]) => (
                <tr>
                  <td>{name}</td>
                  <td>{tokens.toLocaleString()}</td>
                  <td>{savingsReport.tokensSaved > 0 ? `${((tokens / savingsReport.tokensSaved) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </table>
          ) : (
            <p class="text-sm text-muted">No data</p>
          )
        ) : (
          <p class="text-sm text-muted">Savings by Tool data unavailable</p>
        )}
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
      <div class="card" id="versions-card">
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
      {/* allow: SIZE_OK — file dominated by the pre-existing inline upgrade/restart JS; splitting into app.js is out of scope */}
      <script>{html`
        let inlineEventSource = null;
        let lastEventId = 0;
        async function startUpgrade() {
          if (!confirm("ai-dev will restart during this upgrade (2-3s downtime). Proceed?")) return;
          let versions;
          try {
            const versionsRes = await fetch("/api/upgrade/versions");
            versions = await versionsRes.json();
            if (!versionsRes.ok || !versions.official_version) {
              alert(versions.error || versions.warning || "No official release is available");
              return;
            }
          } catch (e) {
            alert("Failed to load the official release: " + (e instanceof Error ? e.message : String(e)));
            return;
          }
          const res = await fetch("/api/upgrade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: versions.official_version }),
          });
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
        async function restartAdmin(event) {
          if (!confirm("Restart admin container? Dashboard will reload after restart completes.")) return;
          const btn = event.target;
          btn.disabled = true;
          btn.textContent = "Restarting...";
          let baselineUptime = null;
          let baselineDigest = null;
          try {
            const baseRes = await fetch("/api/admin/status");
            if (baseRes.ok) {
              const baseData = await baseRes.json();
              if (typeof baseData.uptime_seconds === "number") baselineUptime = baseData.uptime_seconds;
              if (typeof baseData.image_digest === "string" && baseData.image_digest) baselineDigest = baseData.image_digest;
            }
          } catch (_baselineError) {
            baselineUptime = null;
            baselineDigest = null;
          }
          try {
            const res = await fetch("/api/admin/restart", { method: "POST" });
            if (!res.ok) {
              let message = "Failed to restart admin";
              try {
                const data = await res.json();
                if (data && typeof data.error === "string" && data.error) message = data.error;
                else if (data && typeof data.message === "string" && data.message) message = data.message;
              } catch (_parseError) {
                message = "Failed to restart admin";
              }
              alert(message);
              btn.disabled = false;
              btn.textContent = "↻ Restart";
              return;
            }
            const deadline = Date.now() + 120000;
            let observedUnavailability = false;
            const poll = async () => {
              if (Date.now() > deadline) {
                alert("Admin restart timed out — please check container status and logs");
                btn.disabled = false;
                btn.textContent = "↻ Restart";
                return;
              }
              try {
                const statusRes = await fetch("/api/admin/status");
                if (!statusRes.ok) {
                  observedUnavailability = true;
                  setTimeout(poll, 1000);
                  return;
                }
                const statusData = await statusRes.json();
                const newDigest = typeof statusData.image_digest === "string" ? statusData.image_digest : null;
                const newUptime = typeof statusData.uptime_seconds === "number" ? statusData.uptime_seconds : null;
                if (baselineDigest !== null && newDigest !== null && newDigest !== baselineDigest) {
                  location.reload();
                  return;
                }
                if (typeof baselineUptime === "number" && typeof newUptime === "number" && newUptime < baselineUptime) {
                  location.reload();
                  return;
                }
                if (observedUnavailability) {
                  location.reload();
                  return;
                }
              } catch (_pollError) {
                observedUnavailability = true;
              }
              setTimeout(poll, 1000);
            };
            setTimeout(poll, 1000);
          } catch (e) {
            alert("Error: " + (e instanceof Error ? e.message : String(e)));
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
          var card = document.getElementById("versions-card");
          if (!card) return null;
          var existing = document.getElementById("upgrade-inline-progress");
          if (existing) return existing;
          var container = document.createElement("div");
          container.id = "upgrade-inline-progress";
          container.style.marginTop = "12px";
          container.innerHTML = '<div class="progress-bar mb-4"><div class="fill" id="inline-progress-fill" style="width:0%;"></div></div><div id="inline-log-viewer" class="log-viewer" style="max-height:200px;"></div>';
          card.appendChild(container);
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
