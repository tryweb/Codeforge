# Host Script Alpine Linux Compatibility

## Context

`install.sh` and `upgrade.sh` are **host-side scripts** that run directly on the user's machine (not inside the container). Users may run these on Alpine Linux, Ubuntu, or Debian hosts.

The container image is `ubuntu:24.04` — container-internal scripts (`entrypoint.d/*`) use GNU coreutils and `apt-get`. They are **not affected** by BusyBox compatibility issues.

Key architectural boundary:

```
Host (Alpine/Ubuntu/Debian)          Container (Ubuntu 24.04)
┌──────────────────────┐             ┌──────────────────────┐
│ install.sh           │             │ entrypoint.d/*.sh    │
│ upgrade.sh           │──docker──→  │ GNU grep ✓           │
│ BusyBox / GNU tools  │             │ apt-get ✓            │
│ apk / apt-get        │             │ Not affected         │
└──────────────────────┘             └──────────────────────┘
```

## Problem

Alpine Linux ships **BusyBox** versions of common utilities instead of GNU coreutils. Two BusyBox incompatibilities caused failures:

1. **`grep -P` (Perl regex)** — BusyBox grep does not support `-P`. The flag `\K` (lookbehind variant) is GNU-specific. Fails with:
   ```
   grep: unrecognized option: P
   ```
2. **`sort -z` (null delimiter)** — BusyBox sort does not support `-z`.

Additionally, Alpine uses `apk` as its package manager, not `apt-get`. The gh CLI auto-install path silently skipped on Alpine (fell through to "cannot install" message), and the glab install instruction pointed users to the wrong command.

## Solution

Six changes across two files, targeting only BusyBox-incompatible invocations:

### `install.sh` — 3 changes

| # | Location | Before | After |
|---|---|---|---|
| 1 | `show_info()` ip route | `grep -oP 'src \K[^ ]+'` | `awk '{for(i=1;i<=NF;i++) if(\$i=="src") print \$(i+1)}'` |
| 2 | `check_gh_cli()` install | only `apt-get` / `brew` branches | added `apk add gh` branch before `brew` |
| 3 | `check_glab_cli()` message | `sudo apt-get install -y glab` | dynamic: `apk add glab` vs `apt-get install -y glab` |

### `upgrade.sh` — 3 changes

| # | Location | Before | After |
|---|---|---|---|
| 4 | `backup_files()` find + sort | `find ... -print0 \| sort -z` | `find ... -print \| sort` |
| 5 | `cleanup_images()` prune parse | `grep -oP 'Total reclaimed space: \K.*'` | `grep -oE '...' \| sed 's/^...//'` |
| 6 | `show_info()` ip route | `grep -oP 'src \K[^ ]+'` | `awk '{for(i=1;i<=NF;i++) if(\$i=="src") print \$(i+1)}'` |

### No changes made to:

- `[[ ]]` test syntax — requires bash; both scripts already use `#!/usr/bin/env bash`
- Arrays, process substitution `<()`, C-style `for ((;;))` — bash-only features; acceptable since shebang requires bash
- `awk` is safe — BusyBox includes `awk`, Ubuntu/Debian have `gawk`/`mawk`
- Container-side scripts (`entrypoint.d/*`) — unaffected because container is Ubuntu

## Why It Works

- `awk` is POSIX and available on Alpine (BusyBox awk), Ubuntu (gawk), and Debian (mawk)
- `grep -oE` is POSIX ERE (Extended Regular Expression) and supported by BusyBox grep
- `sort` (without `-z`) works on newline-delimited input — safe for backup directory names which are `backup_YYYYMMDD_HHMMSS`
- `sed 's/^pattern //'` is POSIX and supported by BusyBox sed
- `apk` detection via `command -v apk` — same pattern already used for `apt-get` and `brew`

## Side Effects / Tradeoffs

- **bash is still required** on Alpine. User must `apk add bash` before running scripts. This is a one-time setup step. The shebang `#!/usr/bin/env bash` will fail with "not found" if bash is missing — there is no way to check for bash from inside the script.
- **Self-update re-introduces bugs**: `upgrade.sh` has a `self_update()` function that downloads the latest version from the main branch and replaces the local file. Until these changes are merged upstream, each run will overwrite the fixes. Workaround: `UPGRADE_SELF_UPDATED=1 bash upgrade.sh`.
- **`sort -z` fix uses newline separator**: Backup directory names never contain newlines, so this is safe. If future backup names could contain newlines, the sort approach would need revision.

## Evidence

Verified on Alpine host `192.168.11.195` (Alpine 3.24.1):

| Test | Result |
|---|---|
| `bash -n install.sh` | Syntax OK |
| `bash -n upgrade.sh` | Syntax OK |
| `awk` ip route parse | Returns correct `192.168.11.195` |
| `sed` docker prune parse | Returns `123.4MB` (from simulated output) |
| `sort` (no `-z`) backup sort | Lexicographic sort correct for `backup_YYYYMMDD_HHMMSS` |
| `apk` detection | `command -v apk` returns true on Alpine |
| Full `upgrade.sh` run (with `UPGRADE_SELF_UPDATED=1`) | All 9 steps pass, no `grep: unrecognized option: P` errors |
| Web UI after upgrade | `http://192.168.11.195:8000` accessible |

## Related Files

- `install.sh` — host-side installation script
- `upgrade.sh` — host-side upgrade script
- `entrypoint.d/00-fix-perms.sh` — container-side permission fix (chowns `./backups/` to devuser)

## Tags

`alpine` `busybox` `compatibility` `grep` `sort` `install.sh` `upgrade.sh` `host-script` `apk` `cross-platform`
