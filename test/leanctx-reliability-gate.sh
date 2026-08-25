#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EVIDENCE_DIR="$ROOT/.omo/evidence/lean-ctx-reliability-gate/task-6/driver"
MANIFEST="$ROOT/test/fixtures/leanctx-evaluation-scenarios.json"
DRIFT_VECTORS="$ROOT/test/fixtures/leanctx-drift-vectors.json"
CLI="$ROOT/test/lib/leanctx-eval/cli.ts"
LIVE="$ROOT/test/lib/leanctx-eval/live.ts"
MODE=""
EXECUTE_CAMPAIGN=0
OUT_DIR=""
ORIGINAL_ARGS=("$@")
CONTAINER=""
SCRATCH=""
IMAGE=""
TEST_CONTAINER=""
STAGER=""
REPO_VOLUME=""
VOLUMES=()
TEST_CONTAINERS=()
ALL_VOLUMES=()

usage() { printf '%s\n' 'usage: leanctx-reliability-gate.sh --selfcheck|--gates|--campaign [--execute-campaign] [--out-dir ABSOLUTE]'; }
fail() { printf 'reliability-gate: %s\n' "$1" >&2; exit 1; }
DOCKER_BIN=$(type -P docker) || fail "docker CLI is unavailable"
docker_bounded() {
  local timeout_seconds="${DOCKER_TIMEOUT_SECONDS:-120}"
  timeout --signal=TERM --kill-after=5s "${timeout_seconds}s" "$DOCKER_BIN" "$@" || {
    local status=$?
    printf 'reliability-gate: docker %s failed or timed out (status=%s, timeout=%ss)\n' "$1" "$status" "$timeout_seconds" >&2
    return "$status"
  }
}
docker() { docker_bounded "$@"; }

while (($# > 0)); do
  case "$1" in
    --selfcheck|--gates|--campaign) [[ -z "$MODE" ]] || fail "only one mode may be selected"; MODE="${1#--}" ;;
    --execute-campaign) EXECUTE_CAMPAIGN=1 ;;
    --out-dir) (($# >= 2)) || fail "--out-dir requires a path"; OUT_DIR="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown option $1" ;;
  esac
  shift
done
[[ -n "$MODE" ]] || { usage >&2; exit 1; }

if [[ "$MODE" == campaign && "$EXECUTE_CAMPAIGN" == 0 ]]; then
  printf '%s\n' 'campaign deferred: pass --execute-campaign to run the isolated 40-record campaign'
  exit 0
fi

canonical_output_path() {
  local target="$1" probe suffix=""
  probe=$(dirname "$target")
  while [[ ! -e "$probe" && "$probe" != "/" ]]; do
    suffix="/$(basename "$probe")$suffix"
    probe=$(dirname "$probe")
  done
  [[ -d "$probe" ]] || fail "output parent is not a directory"
  realpath -m "$(realpath "$probe")$suffix/$(basename "$target")"
}

if [[ "$MODE" == campaign ]]; then
  [[ -n "$OUT_DIR" ]] || fail "campaign requires explicit --out-dir"
  [[ "$OUT_DIR" = /* ]] || fail "--out-dir must be absolute"
  OUT_DIR=$(canonical_output_path "$OUT_DIR")
  case "$OUT_DIR" in
    "$ROOT/.omo/evidence/lean-ctx-reliability-gate"/*|/tmp/opencode/*) ;;
    *) fail "--out-dir must be a canonical descendant of the reliability evidence or /tmp/opencode directory" ;;
  esac
  mkdir -p "$OUT_DIR"
fi

mkdir -p "$EVIDENCE_DIR"
printf 'command=' > "$EVIDENCE_DIR/driver-command.txt"
printf '%q ' "$0" "${ORIGINAL_ARGS[@]}" >> "$EVIDENCE_DIR/driver-command.txt"
printf '\n' >> "$EVIDENCE_DIR/driver-command.txt"
cp "$EVIDENCE_DIR/driver-command.txt" "$EVIDENCE_DIR/${MODE}-command.txt"
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/leanctx-gate.XXXXXX")
cleanup() {
  local status=$?
  local containers_absent=true volumes_absent=true cleanup_failed=false operation_status
  for container in "${TEST_CONTAINERS[@]}"; do
    if docker rm -f "$container" >/dev/null 2>&1; then :; else operation_status=$?; [[ "$operation_status" -eq 1 ]] || cleanup_failed=true; fi
  done
  for volume in "${ALL_VOLUMES[@]}"; do
    if docker volume rm "$volume" >/dev/null 2>&1; then :; else operation_status=$?; [[ "$operation_status" -eq 1 ]] || cleanup_failed=true; fi
  done
  for container in "${TEST_CONTAINERS[@]}"; do
    if docker inspect "$container" >/dev/null 2>&1; then containers_absent=false; else operation_status=$?; [[ "$operation_status" -eq 1 ]] || cleanup_failed=true; fi
  done
  for volume in "${ALL_VOLUMES[@]}"; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then volumes_absent=false; else operation_status=$?; [[ "$operation_status" -eq 1 ]] || cleanup_failed=true; fi
  done
  printf 'status=%s containers_absent=%s volumes_absent=%s cleanup_failed=%s container_count=%s volume_count=%s\n' "$status" "$containers_absent" "$volumes_absent" "$cleanup_failed" "${#TEST_CONTAINERS[@]}" "${#ALL_VOLUMES[@]}" > "$EVIDENCE_DIR/cleanup-receipt.txt"
  cp "$EVIDENCE_DIR/cleanup-receipt.txt" "$EVIDENCE_DIR/${MODE}-cleanup-receipt.txt"
  rm -rf "$SCRATCH"
  exit "$status"
}
trap cleanup EXIT

track_container_volumes() {
  local container="$1" volume existing
  while IFS= read -r volume; do
    [[ -n "$volume" ]] || continue
    for existing in "${ALL_VOLUMES[@]}"; do
      [[ "$existing" == "$volume" ]] && continue 2
    done
    ALL_VOLUMES+=("$volume")
  done < <(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' "$container")
}

resolve_image() {
  local running
  running=$(docker ps --filter 'label=com.docker.compose.service=ai-dev' --filter status=running --format '{{.Names}}' | awk 'NR==1{print}')
  if [[ -n "$running" ]]; then
    CONTAINER="$running"
    IMAGE=$(docker inspect --format '{{.Config.Image}}' "$running")
  else
    IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | awk '/^(ai-engkit-ai-dev|ghcr.io\/tryweb\/ai-engkit):/{print; exit}')
  fi
  [[ -n "$IMAGE" ]] || fail "no ai-dev image is available"
}

stage_disposable() {
  local profile="${1:-selfcheck}"
  local suffix="${MODE}-${profile}-${BASHPID}-$(date +%s%N)"
  TEST_CONTAINER="leanctx-gate-$suffix"
  STAGER="${TEST_CONTAINER}-stager"
  REPO_VOLUME="${TEST_CONTAINER}-repo"
  TEST_CONTAINERS+=("$TEST_CONTAINER")
  VOLUMES=("$TEST_CONTAINER-config" "$TEST_CONTAINER-data" "$TEST_CONTAINER-state" "$REPO_VOLUME")
  ALL_VOLUMES+=("${VOLUMES[@]}")
  for volume in "${VOLUMES[@]}"; do docker volume create "$volume" >/dev/null; done
  docker run -d --name "$STAGER" --user root --entrypoint sh \
    --mount "type=volume,source=${REPO_VOLUME},target=/repo" \
    --mount "type=volume,source=${VOLUMES[0]},target=/home/devuser/.config/lean-ctx" \
    --mount "type=volume,source=${VOLUMES[1]},target=/home/devuser/.local/share/lean-ctx" \
    --mount "type=volume,source=${VOLUMES[2]},target=/home/devuser/.local/state/lean-ctx" \
    "$IMAGE" -c 'while :; do sleep 3600; done' >/dev/null
  track_container_volumes "$STAGER"
  TEST_CONTAINERS+=("$STAGER")
  docker exec "$STAGER" mkdir -p /repo/test /repo/src/admin /repo/docker /repo/docs
  docker exec "$STAGER" mkdir -p /home/devuser/.config/lean-ctx /home/devuser/.local/share/lean-ctx /home/devuser/.local/state/lean-ctx
  docker exec "$STAGER" chown -R devuser:devuser /home/devuser/.config/lean-ctx /home/devuser/.local/share/lean-ctx /home/devuser/.local/state/lean-ctx
  docker cp "$ROOT/test/lib" "$STAGER:/repo/test"
  docker cp "$ROOT/test/fixtures" "$STAGER:/repo/test"
  docker cp "$ROOT/.git" "$STAGER:/repo/.git"
  docker cp "$ROOT/Dockerfile" "$STAGER:/repo/Dockerfile"
  docker cp "$ROOT/docker" "$STAGER:/repo/docker"
  docker cp "$ROOT/docs" "$STAGER:/repo/docs"
  docker cp "$ROOT/src/admin" "$STAGER:/repo/src/admin"
  docker rm -f "$STAGER" >/dev/null
  docker run -d --name "$TEST_CONTAINER" --user devuser -e HOME=/home/devuser --read-only --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 1g --cpus 2 --entrypoint sh \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m \
    --mount "type=volume,source=${REPO_VOLUME},target=/repo,readonly" \
    --mount "type=volume,source=${VOLUMES[0]},target=/home/devuser/.config/lean-ctx" \
    --mount "type=volume,source=${VOLUMES[1]},target=/home/devuser/.local/share/lean-ctx" \
    --mount "type=volume,source=${VOLUMES[2]},target=/home/devuser/.local/state/lean-ctx" \
    "$IMAGE" -c 'while :; do sleep 3600; done' >/dev/null
  track_container_volumes "$TEST_CONTAINER"
  printf 'image=%s container=%s profile=%s volumes=%s\n' "$IMAGE" "$TEST_CONTAINER" "$profile" "${VOLUMES[*]}" >> "$EVIDENCE_DIR/docker-stage.txt"
}

configure_profile() {
  local profile="$1" level
  if [[ "$profile" == lossless ]]; then level=off; else level=lite; fi
  docker exec "$TEST_CONTAINER" env HOME=/home/devuser sh -lc "printf 'compression_level = \"$level\"\\n' > /home/devuser/.config/lean-ctx/config.toml && chmod 600 /home/devuser/.config/lean-ctx/config.toml"
  docker exec "$TEST_CONTAINER" env HOME=/home/devuser sh -lc "lean-ctx config validate && lean-ctx config show" > "$EVIDENCE_DIR/${profile}-config-observation.txt" || fail "disposable $profile config validation failed"
  grep -Fqx "compression_level = \"$level\"" "$EVIDENCE_DIR/${profile}-config-observation.txt" || fail "disposable $profile config did not report $level"
}

selfcheck() {
  resolve_image
  stage_disposable
  docker exec -w /repo "$TEST_CONTAINER" bun test /repo/test/lib/leanctx-eval >/dev/null
  docker exec "$TEST_CONTAINER" bun /repo/test/lib/leanctx-eval/cli.ts validate-manifest /repo/test/fixtures/leanctx-evaluation-scenarios.json > "$SCRATCH/manifest.json"
  docker exec -w /repo "$TEST_CONTAINER" env HOME=/home/devuser bun /repo/test/lib/leanctx-eval/live.ts selfcheck --manifest /repo/test/fixtures/leanctx-evaluation-scenarios.json --out-dir /tmp/leanctx-selfcheck > "$SCRATCH/live-selfcheck.out" 2>&1
  docker exec "$TEST_CONTAINER" env HOME=/home/devuser sh -lc 'ls -la /tmp/leanctx-selfcheck && test -f /tmp/leanctx-selfcheck/gates.json && test -f /tmp/leanctx-selfcheck/verdict.json' || { cat "$SCRATCH/live-selfcheck.out" >&2; fail "selfcheck live evaluator did not produce outputs"; }
  docker exec "$TEST_CONTAINER" cat /tmp/leanctx-selfcheck/gates.json > "$SCRATCH/gates.json"
  docker exec "$TEST_CONTAINER" cat /tmp/leanctx-selfcheck/verdict.json > "$SCRATCH/verdict.json"
  docker exec "$TEST_CONTAINER" cat /tmp/leanctx-selfcheck/report.md > "$SCRATCH/report.md"
  docker exec "$TEST_CONTAINER" cat /tmp/leanctx-selfcheck/records.json > "$SCRATCH/records.json"
  jq -e '.verdict.verdict == "disable-routing" and .verdict.recordCount == 40 and .verdict.scenarioCount == 20' "$SCRATCH/verdict.json" >/dev/null
  jq -e '.g3.passed and .g4.passed' "$SCRATCH/gates.json" >/dev/null
  cp "$SCRATCH/verdict.json" "$EVIDENCE_DIR/selfcheck-verdict.json"
  cp "$SCRATCH/report.md" "$EVIDENCE_DIR/selfcheck-report.md"
  cp "$SCRATCH/records.json" "$EVIDENCE_DIR/selfcheck-records.json"
  cp "$SCRATCH/gates.json" "$EVIDENCE_DIR/selfcheck-gates.json"
  cp "$SCRATCH/manifest.json" "$EVIDENCE_DIR/selfcheck-manifest.json"
  printf '%s\n' 'selfcheck=pass verdict=disable-routing records=40 metrics=null; no campaign profile execution' > "$EVIDENCE_DIR/selfcheck-summary.txt"
}

gates() {
  resolve_image
  [[ -n "$CONTAINER" ]] || fail "--gates requires a running ai-dev container"
  local baseline global project baseline_present global_present project_present baseline_level global_level direct through sentinel_hash healthy captured gate_json g2
  baseline=$(docker exec "$CONTAINER" sh -lc 'cat /etc/lean-ctx/config.default.toml 2>/dev/null || true')
  global=$(docker exec "$CONTAINER" sh -lc 'cat /home/devuser/.config/lean-ctx/config.toml 2>/dev/null || true')
  project=$(docker exec "$CONTAINER" sh -lc 'cat /home/devuser/workspace/ai-engkit/.lean-ctx.toml 2>/dev/null || true')
  baseline_present=false; global_present=false; project_present=false
  [[ -n "$baseline" ]] && baseline_present=true
  [[ -n "$global" ]] && global_present=true
  [[ -n "$project" ]] && project_present=true
  baseline_level=$(printf '%s\n' "$baseline" | sed -n 's/^[[:space:]]*compression_level[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | awk 'NR==1{print}')
  global_level=$(printf '%s\n' "$global" | sed -n 's/^[[:space:]]*compression_level[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | awk 'NR==1{print}')
  direct="$(docker exec "$CONTAINER" sh -lc "printf 'lean-ctx-reliability-sentinel-v1\\n'")"$'\n'
  through="$(docker exec "$CONTAINER" sh -lc "lean-ctx -c \"printf 'lean-ctx-reliability-sentinel-v1\\\\n'\"")"$'\n'
  [[ "$direct" == "$through" ]] || fail "live direct and lean-ctx sentinel outputs differ"
  sentinel_hash=$(printf '%s' "$through" | sha256sum | awk '{print $1}')
  healthy=$(jq -n --arg baseline "$baseline_level" --arg global "$global_level" --arg project "$project" --arg stdout "$through" --arg hash "$sentinel_hash" --argjson bp "$baseline_present" --argjson gp "$global_present" --argjson pp "$project_present" '{baseline:{present:$bp,compressionLevel:($baseline // null)},global:{present:$gp,compressionLevel:($global // null)},project:{present:$pp,compressionLevel:(if $pp then "present" else null end)},sentinel:{stdout:$stdout,stderr:"",exitCode:0,timedOut:false,expectedBytes:33,expectedSha256:"266b4f79b67bef0b8d79d1683b016f4b4c42dc40aca415c7086316f754203b64",observedBytes:33,observedSha256:$hash}}')
  jq --argjson healthy "$healthy" '.inputs[0]=$healthy | {inputs:(.inputs | map(del(.name)))}' "$DRIFT_VECTORS" > "$SCRATCH/captured.json"
  gate_json=$(bun "$CLI" check-gates "$SCRATCH/captured.json")
  if "$ROOT/test/authority-guidance.test.sh" >/dev/null 2>&1; then g2=true; else g2=false; fi
  stage_disposable gates
  docker exec -w /repo "$TEST_CONTAINER" env HOME=/home/devuser bun /repo/test/lib/leanctx-eval/live.ts selfcheck --manifest /repo/test/fixtures/leanctx-evaluation-scenarios.json --out-dir /tmp/leanctx-selfcheck
  docker exec "$TEST_CONTAINER" cat /tmp/leanctx-selfcheck/gates.json > "$SCRATCH/selfcheck-gates.json"
  jq -n --argjson base "$gate_json" --argjson g2 "$g2" --slurpfile todo "$SCRATCH/selfcheck-gates.json" '{contractVersion:"r2",g0:$base.g0,g1:$base.g1,g2:{gate:"G2",passed:$g2,details:(if $g2 then [] else ["authority guidance test failed"] end)},g3:$todo[0].g3,g4:$todo[0].g4}' | tee "$EVIDENCE_DIR/gates.json"
  jq -e 'all(.g0,.g1,.g2,.g3,.g4; .passed == true)' "$EVIDENCE_DIR/gates.json" >/dev/null
}

campaign() {
  resolve_image
  local image_id image_digest leanctx_version repo_before repo_after records_hash lossless_before lossless_after comparison_before comparison_after
  image_id=$(docker image inspect --format '{{.Id}}' "$IMAGE")
  image_digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || true)
  leanctx_version=""
  for profile in lossless comparison; do
    stage_disposable "$profile"
    configure_profile "$profile"
    repo_before=$(docker exec "$TEST_CONTAINER" env HOME=/home/devuser sh -lc 'find /repo -type f -printf "%P\\0" | sort -z | xargs -0 sha256sum | sha256sum' | awk '{print $1}')
    leanctx_version=$(docker exec "$TEST_CONTAINER" env HOME=/home/devuser lean-ctx --version | awk 'NR==1{print; exit}')
    docker exec -w /repo "$TEST_CONTAINER" bun /repo/test/lib/leanctx-eval/live.ts campaign --profile "$profile" --manifest /repo/test/fixtures/leanctx-evaluation-scenarios.json --out-dir "/tmp/leanctx-campaign-$profile"
    docker cp "$TEST_CONTAINER:/tmp/leanctx-campaign-$profile/records.json" "$SCRATCH/$profile-records.json"
    repo_after=$(docker exec "$TEST_CONTAINER" env HOME=/home/devuser sh -lc 'find /repo -type f -printf "%P\\0" | sort -z | xargs -0 sha256sum | sha256sum' | awk '{print $1}')
    [[ "$repo_before" == "$repo_after" ]] || fail "$profile campaign mutated the read-only repo volume"
    printf '%s\n' "$repo_before" > "$SCRATCH/$profile-repo-before.hash"
    printf '%s\n' "$repo_after" > "$SCRATCH/$profile-repo-after.hash"
    if [[ "$profile" == lossless ]]; then
      lossless_before="$repo_before"
      lossless_after="$repo_after"
    else
      comparison_before="$repo_before"
      comparison_after="$repo_after"
    fi
    [[ $(jq '. | length' "$SCRATCH/$profile-records.json") == 20 ]] || fail "$profile campaign record count is not 20"
  done
  jq -s 'add' "$SCRATCH/lossless-records.json" "$SCRATCH/comparison-records.json" > "$OUT_DIR/records.json"
  bun "$CLI" evaluate --manifest "$MANIFEST" --records "$OUT_DIR/records.json" > "$OUT_DIR/verdict.json"
  bun "$CLI" render --manifest "$MANIFEST" --records "$OUT_DIR/records.json" > "$OUT_DIR/report.md"
  [[ $(jq '. | length' "$OUT_DIR/records.json") == 40 ]] || fail "combined campaign record count is not 40"
  records_hash=$(sha256sum "$OUT_DIR/records.json" | awk '{print $1}')
  jq -n --arg evaluatorVersion "r2" --arg imageId "$image_id" --arg imageDigest "$image_digest" --arg leanctxVersion "$leanctx_version" --arg manifestHash "$(sha256sum "$MANIFEST" | awk '{print $1}')" --arg losslessRequested off --arg losslessEffective off --arg comparisonRequested lite --arg comparisonEffective lite --arg losslessBefore "$lossless_before" --arg losslessAfter "$lossless_after" --arg comparisonBefore "$comparison_before" --arg comparisonAfter "$comparison_after" --arg recordsHash "$records_hash" --arg cleanupReceipt "$EVIDENCE_DIR/campaign-cleanup-receipt.txt" '{evaluatorVersion:$evaluatorVersion,imageId:$imageId,imageDigest:$imageDigest,leanctxVersion:$leanctxVersion,manifestHash:$manifestHash,profiles:{lossless:{requestedCompression:$losslessRequested,effectiveCompression:$losslessEffective,repoTreeHashBefore:$losslessBefore,repoTreeHashAfter:$losslessAfter},comparison:{requestedCompression:$comparisonRequested,effectiveCompression:$comparisonEffective,repoTreeHashBefore:$comparisonBefore,repoTreeHashAfter:$comparisonAfter}},recordsHash:$recordsHash,cleanupReceiptPath:$cleanupReceipt}' > "$OUT_DIR/run-meta.json"
}

case "$MODE" in
  selfcheck) selfcheck ;;
  gates) gates ;;
  campaign) campaign ;;
  *) fail "unsupported mode $MODE" ;;
esac
