import type { FC } from "hono/jsx";

const categoryLabels: Record<string, string> = {
  core: "Core",
  cli: "CLI",
  mcp: "MCP",
  plugin: "Plugin",
};

const imageMetaLabels: Record<string, string> = {
  image: "Image",
  digest: "Digest",
  created: "Created",
  version: "Version",
};

const categoryOrder = ["core", "cli", "mcp", "plugin"];

const CategoryCard: FC<{ title: string; tools: Record<string, string> }> = ({ title, tools }) => (
  <div class="card">
    <h3>{title}</h3>
    <table>
      {Object.entries(tools).map(([name, version]) => (
        <tr>
          <td>{name}</td>
          <td><code>{version || <span class="text-muted">unavailable</span>}</code></td>
        </tr>
      ))}
    </table>
  </div>
);

export const VersionsContent: FC<{
  versionsByCategory: Record<string, Record<string, string>>;
  imageMeta: Record<string, string>;
}> = ({ versionsByCategory, imageMeta }) => (
  <div>
    <h2 style="margin-bottom:24px;">Component Versions</h2>
    <div class="card">
      <h3>Image Metadata</h3>
      <table>
        {Object.entries(imageMeta).map(([k, v]) => (
          <tr><td>{imageMetaLabels[k] || k}</td><td><code>{v}</code></td></tr>
        ))}
      </table>
    </div>
    <div class="grid-2">
      {categoryOrder.map((key) => {
        const tools = versionsByCategory[key];
        if (!tools) return null;
        return <CategoryCard title={categoryLabels[key] || key} tools={tools} />;
      })}
    </div>
  </div>
);

export interface VersionsViewData {
  versionsByCategory: Record<string, Record<string, string>>;
  imageMeta: Record<string, string>;
}
