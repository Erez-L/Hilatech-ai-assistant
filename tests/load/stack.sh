#!/usr/bin/env bash
# Start/stop the isolated load-test API + workers (ports 4150/4151, DB hilatech_load, Redis db 7, prefix bull-load).
# Usage: tests/load/stack.sh start|stop|status|restart   (extra env can be passed: POOL_ENV=... see below)
# API_DIST / WORKERS_DIST select the build directory (default dist). Extra environment for experiments can be added with: EXTRA_ENV="KEY=val KEY2=val" tests/load/stack.sh start
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
RUN=/tmp/hilatech-load
mkdir -p "$RUN"

load_env() {
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env"
  # shellcheck disable=SC1091
  source "$HERE/load.env"
  for kv in ${EXTRA_ENV:-}; do export "$kv"; done
  set +a
}

start() {
  load_env
  [[ "$DATABASE_URL" == *"/hilatech_load"* ]] || { echo "refusing: DATABASE_URL is not hilatech_load"; exit 1; }
  cd "$REPO/apps/api"
  nohup node "${API_DIST:-dist}/main.js" >"$RUN/api.log" 2>&1 &
  echo $! >"$RUN/api.pid"
  cd "$REPO/apps/workers"
  nohup node "${WORKERS_DIST:-dist}/main.js" >"$RUN/workers.log" 2>&1 &
  echo $! >"$RUN/workers.pid"
  for i in $(seq 1 60); do
    curl -fs "http://localhost:$API_PORT/api/v1/health" >/dev/null 2>&1 && { echo "api up (pid $(cat "$RUN/api.pid")), workers pid $(cat "$RUN/workers.pid")"; return; }
    sleep 1
  done
  echo "api did not come up; see $RUN/api.log"; tail -20 "$RUN/api.log"; exit 1
}

stop() {
  for n in api workers; do
    [[ -f "$RUN/$n.pid" ]] && kill "$(cat "$RUN/$n.pid")" 2>/dev/null || true
    rm -f "$RUN/$n.pid"
  done
  echo stopped
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status) for n in api workers; do [[ -f "$RUN/$n.pid" ]] && ps -p "$(cat "$RUN/$n.pid")" -o pid,rss,pcpu,cmd || echo "$n not running"; done ;;
  *) echo "usage: $0 start|stop|restart|status"; exit 1 ;;
esac
