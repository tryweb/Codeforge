/**
 * Safe OpenChamber project registration against settings.json.
 *
 * Every write goes through a per-file mktemp temp file with umask 077,
 * a jq -e shape-validated merge, a post-write verification pass, and an
 * atomic mv — so a malformed settings file or a failed jq run leaves the
 * original file untouched. Unrelated settings keys are preserved.
 */
import type { ExecResult } from "./docker";

export type SettingsCommand = (command: string, timeoutMs: number) => Promise<ExecResult>;

const MERGE_TIMEOUT_MS = 10_000;

/**
 * Project names become directory names under the workspace root and jq/shell
 * arguments. Allow letters, digits, dot, underscore, dash, and inner spaces;
 * forbid path separators, traversal, and shell-active characters.
 */
const PROJECT_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,62}[A-Za-z0-9._-])?$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME.test(name) && !name.includes("..");
}

export function projectId(fullPath: string): string {
  return "path_" + Buffer.from(fullPath).toString("base64");
}

export type MergeAction =
  | { kind: "add"; id: string; path: string; now: number }
  | { kind: "remove"; id: string; path: string };

const SHAPE_GUARD =
  'if type != "object" then error("settings must be an object") ' +
  'elif has("projects") and (.projects | type != "array") then error("projects must be an array") ';

/** Keep entries that are not the target; non-object entries are preserved untouched. */
const KEEP_OTHERS = 'map(select(type != "object" or (.path != $path and .id != $id)))';

/** True for entries matching the target id or path; non-object entries never match. */
const MATCHES = 'type == "object" and (.path == $path or .id == $id)';
const MATCH_COUNT = `[.projects[] | select(${MATCHES})] | length`;

/**
 * Add: if matching entries exist, the first one survives in place with its
 * metadata intact — only the canonical id/path and lastOpenedAt are updated —
 * and later duplicates are dropped. Otherwise a new entry is appended.
 */
const ADD_UPDATE =
  'else (.projects // []) as $p ' +
  `| ([range(0; ($p | length))] | map(select($p[.] | ${MATCHES}))) as $idx ` +
  '| if ($idx | length) == 0 then ' +
  '.projects = ($p + [{id: $id, path: $path, addedAt: $now, lastOpenedAt: $now}]) ' +
  'else .projects = ([range(0; ($p | length)) as $i | $p[$i] | ' +
  'if ($idx | index($i)) == null then . ' +
  'elif $i == $idx[0] then . + {id: $id, path: $path, lastOpenedAt: $now} ' +
  'else empty end]) ' +
  'end end';

function updateProgram(action: MergeAction): string {
  if (action.kind === "add") {
    return SHAPE_GUARD + ADD_UPDATE;
  }
  return SHAPE_GUARD + `else .projects = ((.projects // []) | ${KEEP_OTHERS}) end`;
}

function verifyProgram(action: MergeAction): string {
  const expected = action.kind === "add" ? 1 : 0;
  return `type == "object" and (.projects | type == "array") and ((${MATCH_COUNT}) == ${expected})`;
}

function mergeCommand(settingsPath: string, action: MergeAction): string {
  const args = `--arg path ${JSON.stringify(action.path)} --arg id ${JSON.stringify(action.id)}`;
  const nowArg = action.kind === "add" ? ` --argjson now ${action.now}` : "";
  return `SETTINGS=${JSON.stringify(settingsPath)}; ` +
    `mkdir -p "$(dirname \"$SETTINGS\")" && ` +
    `if [ ! -e "$SETTINGS" ]; then printf '%s\\n' '{}' > "$SETTINGS"; fi && ` +
    `umask 077; TMP="$(mktemp \"$SETTINGS.tmp.XXXXXX\")" && ` +
    `jq -e ${args}${nowArg} '${updateProgram(action)}' "$SETTINGS" > "$TMP" || { rm -f "$TMP"; exit 1; }; ` +
    `jq -e ${args} '${verifyProgram(action)}' "$TMP" > /dev/null || { rm -f "$TMP"; exit 1; }; ` +
    `mv "$TMP" "$SETTINGS"`;
}

export type MergeResult = { ok: true } | { ok: false; error: string };

/**
 * Add or remove one project entry. Any non-zero exit (jq shape error,
 * missing jq, timeout) is a failure: the caller must not report success.
 */
export async function mergeOpenChamberProject(
  command: SettingsCommand,
  settingsPath: string,
  action: MergeAction,
): Promise<MergeResult> {
  const result = await command(mergeCommand(settingsPath, action), MERGE_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr.trim() || "Could not update OpenChamber settings" };
  }
  return { ok: true };
}

/**
 * Read registered project names under the workspace root. Tolerates a missing
 * or malformed settings file (returns []): the sync overview is best-effort.
 */
export async function readOpenChamberProjects(
  command: SettingsCommand,
  settingsPath: string,
  workspaceRoot: string,
): Promise<string[]> {
  const prefix = `${workspaceRoot}/`;
  const result = await command(
    `jq -r --arg prefix ${JSON.stringify(prefix)} ` +
    `'if type == "object" then (.projects // [])[] | select(type == "object" and (.path | type == "string") and (.path | startswith($prefix))) | .path else empty end' ` +
    `${JSON.stringify(settingsPath)} 2>/dev/null || true`,
    MERGE_TIMEOUT_MS,
  );
  return result.stdout.split("\n").filter(Boolean).map((p) => p.slice(prefix.length));
}
