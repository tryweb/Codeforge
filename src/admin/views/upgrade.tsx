import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const UpgradeContent: FC = () => (
  <div>
    <h2 style="margin-bottom:24px;">Upgrade Engine</h2>
    <div id="status-banner" />
    <div class="card">
      <h3>Upgrade ai-dev Container</h3>
      <p class="text-sm text-muted mb-4">Pulls the latest image, backs up config, recreates the ai-dev container.</p>
      <button id="start-upgrade" onclick="startUpgrade()">▲ Start Upgrade</button>
      <button id="cancel-upgrade" class="btn-danger" style="display:none;margin-left:8px;" onclick="cancelUpgrade()">Cancel</button>
    </div>
    <div class="card" id="progress-card" style="display:none;">
      <h3>Progress</h3>
      <div class="progress-bar mb-4"><div class="fill" id="progress-fill" style="width:0%;" /></div>
      <div class="log-viewer" id="log-viewer" />
    </div>
    <script>{`
      let eventSource = null;
      async function startUpgrade() {
        document.getElementById("start-upgrade").disabled = true;
        document.getElementById("start-upgrade").textContent = "Running...";
        document.getElementById("progress-card").style.display = "block";
        const res = await fetch("/api/upgrade", { method: "POST" });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Upgrade already in progress");
          document.getElementById("start-upgrade").disabled = false;
          document.getElementById("start-upgrade").textContent = "▲ Start Upgrade";
          return;
        }
        connectLog();
      }
      function connectLog() {
        eventSource = new EventSource("/api/upgrade/log");
        const steps = ["digest_compare","backup","merge_env","recreate","poll_health","cleanup"];
        const stepIdx = {};
        steps.forEach((s, i) => stepIdx[s] = i);
        eventSource.onmessage = (e) => {
          const ev = JSON.parse(e.data);
          const viewer = document.getElementById("log-viewer");
          const entry = document.createElement("div");
          entry.className = "log-entry";
          entry.innerHTML = '<span class="time">' + new Date(ev.timestamp).toLocaleTimeString() + '</span>' +
            '<span class="step">' + ev.step + '</span>' +
            '<span class="status ' + (ev.status === 'success' ? 'text-success' : ev.status === 'failure' ? 'text-danger' : '') + '">' + ev.status + '</span>' +
            '<span>' + ev.message + '</span>';
          viewer.appendChild(entry);
          viewer.scrollTop = viewer.scrollHeight;
          if (ev.status === "success" || ev.status === "failure") {
            const idx = stepIdx[ev.step];
            if (idx !== undefined) {
              const pct = Math.round(((idx + 1) / steps.length) * 100);
              document.getElementById("progress-fill").style.width = pct + "%";
            }
          }
          if (ev.status === "failure") {
            document.getElementById("start-upgrade").disabled = false;
            document.getElementById("start-upgrade").textContent = "▲ Retry Upgrade";
            eventSource.close();
          }
          if (ev.step === "cleanup" && ev.status === "success") {
            document.getElementById("start-upgrade").disabled = false;
            document.getElementById("start-upgrade").textContent = "▲ Start Upgrade";
            document.getElementById("status-banner").innerHTML =
              '<div class="card" style="border-color:var(--success);"><strong class="text-success">✓ Upgrade completed successfully</strong></div>';
            eventSource.close();
          }
        };
        eventSource.onerror = () => { eventSource.close(); };
      }
      function cancelUpgrade() {
        if (eventSource) eventSource.close();
        document.getElementById("start-upgrade").disabled = false;
        document.getElementById("start-upgrade").textContent = "▲ Start Upgrade";
      }
      fetch("/api/upgrade/log?history=1").then(r => r.json()).then(events => {
        if (events.length > 0) {
          document.getElementById("progress-card").style.display = "block";
          const viewer = document.getElementById("log-viewer");
          events.forEach(ev => {
            const entry = document.createElement("div"); entry.className = "log-entry";
            entry.innerHTML = '<span class="time">' + new Date(ev.timestamp).toLocaleTimeString() + '</span>' +
              '<span class="step">' + ev.step + '</span>' +
              '<span class="status ' + (ev.status === 'success' ? 'text-success' : ev.status === 'failure' ? 'text-danger' : '') + '">' + ev.status + '</span>' +
              '<span>' + ev.message + '</span>';
            viewer.appendChild(entry);
          });
        }
      });
    `}</script>
  </div>
);

export function UpgradePage() {
  return (
    <Layout title="Upgrade" currentPath="/upgrade">
      <UpgradeContent />
    </Layout>
  );
}
