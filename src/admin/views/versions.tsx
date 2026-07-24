import type { FC } from "hono/jsx";
import { Layout } from "./layout";

const VersionsContent: FC<{ versions: Record<string, string>; imageMeta: Record<string, string> }> = ({ versions, imageMeta }) => (
  <div>
    <h2 style="margin-bottom:24px;">Component Versions</h2>
    <div class="card">
      <h3>Image Metadata</h3>
      <table>
        {Object.entries(imageMeta).map(([k, v]) => (
          <tr><td>{k}</td><td><code>{v}</code></td></tr>
        ))}
      </table>
    </div>
    <div class="card">
      <h3>Components</h3>
      <table>
        <tr><th>Component</th><th>Version</th></tr>
        {Object.entries(versions).map(([name, version]) => (
          <tr><td>{name}</td><td><code>{version || <span class="text-muted">unavailable</span>}</code></td></tr>
        ))}
      </table>
    </div>
  </div>
);

export function VersionsPage(versions: Record<string, string>, imageMeta: Record<string, string>) {
  return (
    <Layout title="Versions" currentPath="/versions">
      <VersionsContent versions={versions} imageMeta={imageMeta} />
    </Layout>
  );
}
