#!/usr/bin/env bash
# Installs deploy/helm/docket on a kind cluster, mints an owner's and an
# editor's token in the pod, and runs docket serve's gates (e2e.mjs) through
# a port-forward: tools/list first, then the rest.
#
#   deploy/test/kind-smoke.sh            # the default: no database
#   deploy/test/kind-smoke.sh postgres   # with the bundled Postgres
#
# DOCKET_IMAGE names the image to test, already built here; it is loaded into
# the cluster, never pulled. DOCKET_SMOKE_CLUSTER names a kind cluster to use;
# without it one is created for the run and deleted after.
set -euo pipefail

mode="${1:-files}"
here="$(cd "$(dirname "$0")" && pwd)"
chart="$(cd "$here/../helm/docket" && pwd)"
image="${DOCKET_IMAGE:-ghcr.io/chrisjowen/docket:dev}"
cluster="${DOCKET_SMOKE_CLUSTER:-docket-smoke-$$}"
namespace="docket-smoke-$mode"
created=""
forward=""

cleanup() {
  status=$?
  [ -n "$forward" ] && kill "$forward" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    kubectl --context "kind-$cluster" -n "$namespace" get pods -o wide || true
    kubectl --context "kind-$cluster" -n "$namespace" logs deploy/docket --all-containers --tail 80 || true
  fi
  if [ -n "$created" ]; then kind delete cluster --name "$cluster" >/dev/null 2>&1 || true
  else helm --kube-context "kind-$cluster" uninstall docket -n "$namespace" >/dev/null 2>&1 || true
       kubectl --context "kind-$cluster" delete namespace "$namespace" --wait=false >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

if ! kind get clusters 2>/dev/null | grep -qx "$cluster"; then
  kind create cluster --name "$cluster" --wait 120s
  created=1
fi
kubectl() { command kubectl --context "kind-$cluster" -n "$namespace" "$@"; }
kind load docker-image "$image" --name "$cluster"

values=(--set "image.repository=${image%:*}" --set "image.tag=${image##*:}" --set image.pullPolicy=Never --set workspace=smoke)
store=files
if [ "$mode" = postgres ]; then
  values+=(--set postgres.enabled=true --set postgres.bundled.enabled=true)
  store=postgres
fi
helm --kube-context "kind-$cluster" install docket "$chart" -n "$namespace" --create-namespace "${values[@]}" --wait --timeout 6m

token() {
  kubectl exec deploy/docket -c docket -- docket serve token create "$1" --role "$2" | awk '/^  dks_/ { print $1 }'
}
DOCKET_E2E_OWNER_TOKEN="$(token smoke-owner owner)"
DOCKET_E2E_EDITOR_TOKEN="$(token smoke-editor editor)"
export DOCKET_E2E_OWNER_TOKEN DOCKET_E2E_EDITOR_TOKEN
[ -n "$DOCKET_E2E_OWNER_TOKEN" ] && [ -n "$DOCKET_E2E_EDITOR_TOKEN" ] || { echo "could not mint the tokens" >&2; exit 1; }

port="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
kubectl port-forward svc/docket "$port:4390" >/dev/null 2>&1 &
forward=$!
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$port/healthz" >/dev/null && break; sleep 1; done

# The gate in brief: a token minted in the pod lists the MCP tools.
listed="$(curl -sf "http://127.0.0.1:$port/mcp/smoke" -H "authorization: Bearer $DOCKET_E2E_OWNER_TOKEN" \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.tools.length))")"
echo "✓ tools/list over the chart's service answers $listed tools"
[ "$listed" = 11 ]

if [ "$store" = files ]; then index=/data/docket/.docket/.index; else index=/data/state/index/smoke/.index; fi
export DOCKET_E2E_URL="http://127.0.0.1:$port"
export DOCKET_E2E_WORKSPACE=smoke
export DOCKET_E2E_STORE="$store"
export DOCKET_E2E_DROP_INDEX="kubectl --context 'kind-$cluster' -n '$namespace' exec deploy/docket -c docket -- /nodejs/bin/node -e \"require('fs').rmSync('$index',{recursive:true,force:true})\""
node "$here/e2e.mjs"
