#!/usr/bin/env bash
# Starts deploy/compose on this host as a throwaway project, mints an owner's
# and an editor's token, and runs docket serve's gates (e2e.mjs) against it;
# then removes the project, its containers and its own volumes.
#
#   deploy/test/compose-e2e.sh            # the default: no database
#   deploy/test/compose-e2e.sh postgres   # with the postgres profile
#
# DOCKET_IMAGE names the image to test (built or pulled beforehand: nothing
# here pulls the docket image). DOCKET_E2E_COMPOSE_OVERRIDE adds a Compose
# file over compose.yaml, e.g. to give the network a fixed subnet.
set -euo pipefail

profile="${1:-}"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$(cd "$here/../compose" && pwd)"
project="docket-e2e-${profile:-files}-$$"
export DOCKET_IMAGE="${DOCKET_IMAGE:-ghcr.io/chrisjowen/docket:dev}"
export DOCKET_PORT="${DOCKET_PORT:-$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")}"
export DOCKET_WORKSPACE=e2e
# An .env beside compose.yaml would be read too; this run sets everything it needs.
export COMPOSE_PROFILES="$profile"
store=files
if [ "$profile" = postgres ]; then
  export POSTGRES_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('hex'))")"
  export DOCKET_DATABASE_URL="postgres://docket:${POSTGRES_PASSWORD}@postgres:5432/docket"
  export DOCKET_PROJECTIONS=jsonl
  store=postgres
fi

files=(-f "$dir/compose.yaml")
[ -n "${DOCKET_E2E_COMPOSE_OVERRIDE:-}" ] && files+=(-f "$DOCKET_E2E_COMPOSE_OVERRIDE")
compose() { docker compose --project-directory "$dir" "${files[@]}" -p "$project" --env-file /dev/null "$@"; }

cleanup() {
  status=$?
  [ "$status" -ne 0 ] && compose logs --no-color --tail 80 docket || true
  # This run's own throwaway volumes: a real deployment never runs down -v.
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if [ "$profile" = postgres ]; then compose pull --policy missing --quiet postgres; fi
compose up -d --wait --wait-timeout 180

token() {
  compose run --rm --no-deps -T docket serve token create "$1" --role "$2" | awk '/^  dks_/ { print $1 }'
}
DOCKET_E2E_OWNER_TOKEN="$(token e2e-owner owner)"
DOCKET_E2E_EDITOR_TOKEN="$(token e2e-editor editor)"
export DOCKET_E2E_OWNER_TOKEN DOCKET_E2E_EDITOR_TOKEN
[ -n "$DOCKET_E2E_OWNER_TOKEN" ] && [ -n "$DOCKET_E2E_EDITOR_TOKEN" ] || { echo "could not mint the tokens" >&2; exit 1; }

if [ "$store" = files ]; then index=/data/docket/.docket/.index; else index="/data/state/index/$DOCKET_WORKSPACE/.index"; fi
export DOCKET_E2E_URL="http://127.0.0.1:$DOCKET_PORT"
export DOCKET_E2E_WORKSPACE="$DOCKET_WORKSPACE"
export DOCKET_E2E_STORE="$store"
export DOCKET_E2E_DROP_INDEX="docker compose --project-directory '$dir' $(printf "%q " "${files[@]}") -p '$project' --env-file /dev/null exec -T docket /nodejs/bin/node -e \"require('fs').rmSync('$index',{recursive:true,force:true})\""
node "$here/e2e.mjs"
