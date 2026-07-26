# OpenCode Project Skill Discovery Format

## Context

OpenChamber 1.16.3 delegates project skill discovery to the OpenCode 1.18.5
backend. A project-local skill was created in
`/home/devuser/workspace/MyTest-01` but did not appear in the `/` autocomplete.

## Problem

The flat file format below is not discovered by the current OpenCode loader:

```text
.opencode/skills/finalize-maintenance.md
```

Creating a new session or reloading the browser does not make an incorrectly
structured skill appear.

## Solution

Use a directory containing an uppercase `SKILL.md` file:

```text
.opencode/skills/finalize-maintenance/SKILL.md
```

The file must contain valid frontmatter, including `name` and `description`:

```markdown
---
name: finalize-maintenance
description: Finalize maintenance work and generate the maintenance report.
---
```

OpenChamber exposes the current project skill discovery result through:

```text
GET /api/config/skills?directory=<project-directory>
```

For example:

```text
/api/config/skills?directory=/home/devuser/workspace/MyTest-01
```

## Why It Works

The loader scans skill directories for `**/SKILL.md`. After the standard
directory structure was added, the API returned the skill with
`scope: "project"` and the path ending in
`.opencode/skills/finalize-maintenance/SKILL.md`.

The OpenChamber `/` autocomplete then displayed:

```text
/finalize-maintenance
```

## Side Effects / Tradeoffs

- Existing flat `.md` files are not automatically migrated.
- The old flat file can be retained temporarily for comparison, but the
  canonical project skill should use the directory/`SKILL.md` structure.
- The `enable-finalize-maintenance` bootstrap documentation currently creates
  the obsolete flat format and should be updated separately.
- Newer OpenCode versions may provide `reload_skills` or `/reload`; these were
  not present in the target OpenCode 1.18.5 command list.

## Evidence

- Target host: `192.168.11.195` (`ai-engkit-195`)
- OpenCode: `1.18.5`
- OpenChamber: `1.16.3`
- Before conversion: `/api/config/skills` returned 23 skills and no
  `finalize-maintenance` entry.
- After adding `finalize-maintenance/SKILL.md`: the API returned 24 skills and
  the project skill with `scope: "project"`.
- The OpenChamber UI displayed `/finalize-maintenance` in slash autocomplete.

## Related Files

- `docs/knowledge/patterns/enable-xxx-skill-pattern.md`
- `.opencode/baked-skills/enable-finalize-maintenance/SKILL.md`
- `.opencode/baked-skills/enable-finalize-maintenance/bootstrap.sh`

## Tags

`#opencode` `#openchamber` `#skills` `#discovery` `#troubleshooting`
