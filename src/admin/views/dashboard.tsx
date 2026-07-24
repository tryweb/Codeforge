import type { FC } from "hono/jsx";
import { Layout } from "./layout";

interface DashboardData {
  container_status: string;
  uptime_seconds: number | null;
  versions: Record<string, string>;
  gh_auth: string;
  glab_auth: string;
  git_user: string;
  project_count: number;
}

const DashboardContent: FC<{ data: DashboardData }> = ({ data }) => {
  const isRunning = data.container_status === "running";
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
            <tr><td>{name}</td><td><code>{version}</code></td></tr>
          ))}
        </table>
      </div>
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
