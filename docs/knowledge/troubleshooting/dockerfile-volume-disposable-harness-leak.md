# Dockerfile VOLUME Mounts Leak From Disposable Harnesses

## Context

The ai-engkit image declares persistent paths with `VOLUME` in `Dockerfile`. The reliability harness starts short-lived containers with explicit named mounts for its repository and lean-ctx state.

## Problem

`docker run` still creates an anonymous volume for every image-declared `VOLUME` path that the command does not override. Removing the container with `docker rm -f` does not remove those anonymous volumes.

This can leave many 64-character volume names even when all harness-named containers and volumes were removed successfully. A cleanup receipt that tracks only explicitly created volumes can therefore report a false clean state.

## Solution

Inspect each disposable container immediately after `docker run`, before removing it:

```bash
docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$container"
```

Add every returned volume name to the harness's exact cleanup list, deduplicating names already tracked. During cleanup:

1. Remove the disposable containers.
2. Remove every tracked volume.
3. Verify that every tracked container and volume is absent.
4. Compare the sorted post-run Docker volume list with a preflight snapshot.

Use this pattern only when every volume mounted by the inspected container is controlled by the disposable harness. Do not apply it to production or user containers that may mount persistent named volumes.

## Why It Works

Docker exposes both explicit named mounts and image-generated anonymous mounts through the container's `.Mounts` metadata. Capturing the metadata before container removal preserves the only reliable ownership link needed for exact cleanup.

## Side Effects / Tradeoffs

- The cleanup list includes image-declared volumes that the harness did not name itself.
- Future `VOLUME` additions are covered automatically.
- The approach must remain scoped to containers whose complete mount set is disposable.
- A preflight/post-run comparison is still required to detect cleanup regressions or concurrent Docker changes.

## Evidence

- Four reliability runs created 106 new volumes, all labeled `com.docker.volume.anonymous` and created during the run windows.
- None of the 106 volumes was mounted by a remaining container; removing that exact captured set restored the preflight volume list.
- After adding mount discovery, `bash test/leanctx-reliability-gate.test.sh` passed.
- The cleanup receipt reported `containers_absent=true`, `volumes_absent=true`, `cleanup_failed=false`, `container_count=2`, and `volume_count=20`.
- The sorted post-regression volume list and running container name/image list were byte-identical to their preflight snapshots.

## Related Files

- `Dockerfile`
- `test/leanctx-reliability-gate.sh`
- `test/leanctx-reliability-gate.test.sh`
- `.omo/evidence/lean-ctx-reliability-gate/final/f4/summary.md`

## Tags

`docker`, `volumes`, `cleanup`, `test-harness`, `reliability`, `dood`
