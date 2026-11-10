#!/usr/bin/env bash
# A/B comparison of two builds in the same sitting (alternating, to cancel machine drift / noisy neighbours):
#   tests/load/ab.sh dist-base dist-perf 2     # builds A and B (dirs under apps/api and apps/workers), 2 rounds
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
A="${1:-dist-base}"; B="${2:-dist-perf}"; ROUNDS="${3:-2}"
for round in $(seq 1 "$ROUNDS"); do
  for build in "$A" "$B"; do
    "$HERE/stack.sh" stop >/dev/null 2>&1 || true
    sleep 2
    API_DIST="$build" WORKERS_DIST="$build" "$HERE/stack.sh" start >/dev/null
    sleep 3
    echo "### round $round build $build  load1=$(cut -d' ' -f1 /proc/loadavg)"
    tag="ab-${build}-r${round}"
    node "$HERE/run.mjs" --scenario dashboard --stages 5,25 --duration 10 --warmup 3 --tag "$tag" | grep "vus="
    node "$HERE/run.mjs" --scenario conversations --stages 25 --duration 10 --warmup 3 --tag "$tag" | grep "vus="
    node "$HERE/run.mjs" --scenario assistant_json --stages 25 --duration 10 --warmup 3 --tag "$tag" | grep "vus="
    node "$HERE/run.mjs" --scenario leads_list --stages 25 --duration 10 --warmup 3 --tag "$tag" | grep "vus="
    node "$HERE/run.mjs" --scenario agent_async --burst 600 --concurrency 20 --tag "$tag" > /dev/null
  done
done
"$HERE/stack.sh" stop >/dev/null 2>&1 || true
