import { execInAiDev, type ExecResult } from "./docker";

export type GlabCommand = (command: string, timeoutMs: number) => Promise<ExecResult>;

export interface GlabInstance {
  hostname: string;
  username: string;
  authenticated: boolean;
}

/**
 * Reduce a GitLab host input to its bare hostname.
 * Strips scheme and path so "https://gitlab.example.com/" → "gitlab.example.com".
 * A scheme-prefixed value here would create a malformed
 * `credential.https://https://...` git config section that never matches
 * any real remote, leaving git with no credential source.
 */
export function normalizeHostname(input: string): string {
  return input.trim().replace(/^https?:\/\//i, "").split("/")[0];
}

/**
 * Configure git to use the git-credential-glab helper for the given hostname.
 *
 * The helper script is baked into the image at build time
 * (~/.local/bin/git-credential-glab — see scripts/git-credential-glab and the
 * Dockerfile), so it survives container recreation. Only the git config
 * needs to be (re)applied after a successful glab auth login.
 *
 * This replaces the insecure ~/.git-credentials plaintext approach with
 * on-demand token reads from glab's own config.yml — the single source
 * of truth for authentication.
 */
export async function setupGlabCredentialHelper(hostname: string, command: GlabCommand = execInAiDev): Promise<void> {
  // Remove the global store helper (older entrypoints re-added it on every
  // start) so git never caches the token back to plaintext on disk.
  await command("git config --global --unset credential.helper 2>/dev/null || true", 5_000);

  // Defensive re-normalization: only a bare hostname may enter the git config key.
  const escHost = JSON.stringify(normalizeHostname(hostname));
  await command(`git config --global credential.https://${escHost}.helper glab 2>/dev/null || true`, 5_000);
  await command(`git config --global credential.http://${escHost}.helper glab 2>/dev/null || true`, 5_000);

  await command(": > ~/.config/git/.git-credentials 2>/dev/null || true", 5_000);
}

export async function listGlabInstances(command: GlabCommand = execInAiDev): Promise<GlabInstance[]> {
  // Read token-bearing hosts from config.yml
  const configResult = await command(
    `python3 -c '
import yaml
with open("/home/devuser/.config/glab-cli/config.yml") as f:
    data = yaml.safe_load(f)
hosts = data.get("hosts", {})
for h, cfg in hosts.items():
    token = cfg.get("token", "") or ""
    if token:
        print(h)
' 2>/dev/null || true`,
    15_000,
  );

  const instances: GlabInstance[] = [];
  const tokenHosts = new Set(configResult.stdout.trim().split("\n").filter(Boolean));

  if (tokenHosts.size === 0) return instances;

  // Fetch usernames from glab auth status for each host
  const statusResult = await command("glab auth status 2>&1 || true", 15_000);
  const output = statusResult.stdout || statusResult.stderr;
  const usernameMap = new Map<string, string>();

  for (const line of output.split("\n")) {
    const m = line.match(/Logged in to (\S+) as (\S+)/);
    if (m) usernameMap.set(m[1], m[2]);
  }

  for (const hostname of tokenHosts) {
    instances.push({
      hostname,
      username: usernameMap.get(hostname) || "",
      authenticated: true,
    });
  }

  return instances;
}

export async function loginGlabWithToken(
  hostname: string,
  token: string,
  command: GlabCommand = execInAiDev,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await command(
    `glab auth login --hostname ${JSON.stringify(normalizeHostname(hostname))} --token ${JSON.stringify(token)} 2>&1 || true`,
    30_000,
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || "Authentication failed" };
  }
  await setupGlabCredentialHelper(hostname, command);
  return { ok: true };
}

export async function logoutGlab(hostname: string, command: GlabCommand = execInAiDev): Promise<void> {
  if (hostname) {
    await command(`glab auth logout --hostname ${JSON.stringify(normalizeHostname(hostname))} 2>/dev/null || true`, 15_000);
    await command(
      `python3 -c '
import yaml
with open("/home/devuser/.config/glab-cli/config.yml") as f:
    data = yaml.safe_load(f)
hosts = data.get("hosts", {})
h = "${normalizeHostname(hostname)}"
if h in hosts:
    del hosts[h]
    data["hosts"] = hosts
    with open("/home/devuser/.config/glab-cli/config.yml", "w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
' 2>/dev/null || true`,
      15_000,
    );
  } else {
    await command("glab auth logout 2>/dev/null || true", 15_000);
  }
}
