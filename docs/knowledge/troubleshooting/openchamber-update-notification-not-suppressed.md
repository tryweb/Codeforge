# OpenChamber Update Banner Shows Despite Admin Toggle Off (Missing settings Key)

## Context

ai-engkit exposes a server-wide "Show update notifications" toggle at Admin → OpenChamber Settings. Saving it writes `showOpenCodeUpdateNotifications` into `~/.config/openchamber/settings.json` inside the ai-engkit container (persistent `openchamber-data` volume).

OpenChamber web (v1.18.x) gates its OpenCode update toast on that flag, but only when the key is present in the file:

- The settings GET (`/api/config/settings`) echoes only keys that exist on disk (`sanitizeSettingsUpdate` adds no server-side default).
- The web client defaults the flag to **true on web** (`showOpenCodeUpdateNotifications: !isNativePlatform()`), so an absent key = banner shown.
- The Admin page's read defaults an absent key to **false** (`(.showOpenCodeUpdateNotifications // false)`), so its checkbox renders unchecked — the toggle *looks* off while OpenChamber actually treats the setting as on.

## Problem

Reported 2026-08-08 on prod (192.168.11.195): OpenChamber's bottom-right toast "OpenCode update Version 1.18.14 available" kept appearing although the Admin toggle was off. Root cause: `settings.json` had **no `showOpenCodeUpdateNotifications` key at all** — the Admin save had never persisted (file mtime unchanged since deployment; the checkbox was merely showing the absent-key default), and the entrypoint's settings backfill added `defaultModel` only, never the flag.

## Solution

Immediate fix (running install, no rebuild needed):

```bash
docker exec ai-engkit sh -c 'jq ".showOpenCodeUpdateNotifications = false" /home/devuser/.config/openchamber/settings.json > /tmp/s.json && mv /tmp/s.json /home/devuser/.config/openchamber/settings.json'
```

Alternatives that write the same key: click **Save settings** in Admin (even while the box looks unchecked), or toggle the flag off in OpenChamber's own Settings → OpenCode CLI section.

Repo fix (applies on next image build): `ensure_openchamber_default_settings` in `entrypoint.d/lib-openchamber-settings.bash` — called from `entrypoint.d/02-init-config.sh` at every container start — now backfills `showOpenCodeUpdateNotifications: false` into any existing settings file missing the key, on top of the existing `defaultModel` backfill. Upgraded installs self-heal.

## Why It Works

- At boot the entrypoint ensures both keys, so OpenChamber's GET returns `false`; the web toast handler then dismisses the update toast instead of showing it.
- The backfill uses `//=` (sets only when the key is absent/null/false), so a user's deliberate `true`/`false` is never overwritten on restart.
- Per-browser dismissal (localStorage `opencode-update-toast-dismissed-version`) still applies on top of the flag.

## Side Effects / Tradeoffs

- Existing installs keep the banner until the image is rebuilt or the one-line fix above is applied.
- If a user later enables notifications (Admin or OpenChamber settings), the key becomes `true` and subsequent boots do not override it.
- The Admin checkbox and the OpenChamber web default disagree when the key is absent; the entrypoint backfill removes that ambiguity for all future boots.

## Related Files

- `entrypoint.d/lib-openchamber-settings.bash`
- `entrypoint.d/02-init-config.sh`
- `test/test-openchamber-settings-seed.sh`
- `src/admin/routes/openchamber.ts`

## Tags

- openchamber
- update-notification
- showOpenCodeUpdateNotifications
- settings-seed
- backfill
- entrypoint
- troubleshooting
