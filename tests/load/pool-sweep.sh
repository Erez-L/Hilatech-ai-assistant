#!/usr/bin/env bash
# DB pool-size sweep on the load stack (DB_POOL_MAX applies to API and workers): tests/load/pool-sweep.sh 5 10 20 40
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for pool in "$@"; do
  "$HERE/stack.sh" stop >/dev/null 2>&1 || true; sleep 2
  API_DIST="${API_DIST:-dist}" WORKERS_DIST="${WORKERS_DIST:-dist}" EXTRA_ENV="DB_POOL_MAX=$pool" "$HERE/stack.sh" start >/dev/null; sleep 3
  echo "### DB_POOL_MAX=$pool"
  for sc in "dashboard 25" "leads_list 50" "assistant_json 25" "webhook_ingest_sync 50"; do
    set -- $sc
    node "$HERE/run.mjs" --scenario "$1" --stages "$2" --duration 10 --warmup 3 --tag "pool$pool" | grep "vus="
  done
done
"$HERE/stack.sh" stop >/dev/null 2>&1 || true
