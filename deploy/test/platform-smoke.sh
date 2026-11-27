#!/usr/bin/env bash
# Boot the same multi-tenant config under Compose or Helm with the production image.
# DOCKET_IMAGE must name a locally built image.
set -euo pipefail

mode="${1:?usage: platform-smoke.sh compose|helm}"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$here/../compose"
chart="$here/../helm/docket"
config="$dir/docket-server.example.yaml"
image="${DOCKET_IMAGE:-ghcr.io/chrisjowen/docket:dev}"
project="docket-platform-smoke-$$"
scratch="$(mktemp -d)"
port="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
url="http://127.0.0.1:$port"
cluster="${DOCKET_SMOKE_CLUSTER:-docket-platform-$$}"
namespace="$project"
created=""
forward=""

compose() {
  docker compose -p "$project" --env-file /dev/null -f "$dir/compose.multi-tenant.yaml" "${overrides[@]}" "$@"
}
kubectl() { command kubectl --context "kind-$cluster" -n "$namespace" "$@"; }
helm_run() { helm --kube-context "kind-$cluster" -n "$namespace" "$@"; }

cleanup() {
  status=$?
  if [ "$mode" = compose ]; then
    [ "$status" -ne 0 ] && compose logs --tail 60 docket bootstrap || true
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  else
    [ -n "$forward" ] && kill "$forward" 2>/dev/null || true
    if [ "$status" -ne 0 ]; then
      kubectl get pods -o wide || true
      kubectl logs deploy/docket --tail 60 || true
      kubectl logs deploy/docket-worker --tail 60 || true
    fi
    if [ -n "$created" ]; then
      kind delete cluster --name "$cluster" >/dev/null 2>&1 || true
    else
      kubectl delete namespace "$namespace" --wait=false >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$scratch"
  exit "$status"
}

case "$mode" in compose|helm) ;; *) echo "Unknown installer: $mode" >&2; exit 2 ;; esac
overrides=()
trap cleanup EXIT
mkdir "$scratch/secrets" "$scratch/worker-tls"
openssl rand -base64 32 > "$scratch/secrets/kek"
# The smoke directory is private. Mounted files are readable by the image's non-root user.
chmod 644 "$scratch/secrets/kek"
github_secret="$(openssl rand -hex 24)"

check_http() {
  for _ in $(seq 1 60); do curl -fsS "$url/readyz" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS "$url/readyz" >/dev/null
  curl -fsS "$url/signin" | grep -i 'continue with github' >/dev/null
  curl -fsS "$url/.well-known/oauth-authorization-server" |
    node -e 'const m=JSON.parse(require("fs").readFileSync(0)); if (m.issuer !== process.argv[1]) process.exit(1)' "$url"
}

wait_for_inline_worker() {
  for _ in $(seq 1 30); do
    if "$@" | grep 'query service on http://127.0.0.1:' >/dev/null; then return 0; fi
    sleep 2
  done
  echo "inline worker has not started" >&2
  return 1
}

make_worker_tls() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$1" \
    -addext "subjectAltName=DNS:$1" \
    -keyout "$scratch/worker-tls/worker.key" -out "$scratch/worker-tls/worker.crt" >/dev/null 2>&1
  cp "$scratch/worker-tls/worker.crt" "$scratch/worker-tls/ca.crt"
  chmod 644 "$scratch/worker-tls/worker.key"
}

if [ "$mode" = compose ]; then
  export DOCKET_IMAGE="$image" DOCKET_PORT="$port" DOCKET_PUBLIC_URL="$url" DOCKET_BIND=127.0.0.1
  export DOCKET_SERVER_CONFIG="$config" DOCKET_SECRETS_DIR="$scratch/secrets" DOCKET_WORKER_TLS_DIR="$scratch/worker-tls"
  export DOCKET_GITHUB_CLIENT_SECRET="$github_secret" COMPOSE_PROFILES=postgres,graph,semantic
  export POSTGRES_PASSWORD="$(openssl rand -hex 24)" DOCKET_PG_APP_PASSWORD="$(openssl rand -hex 24)"
  export NEO4J_PASSWORD="$(openssl rand -hex 24)" QDRANT_API_KEY="$(openssl rand -hex 24)"
  export EMBEDDER_MODELS=""
  compose pull --policy missing --quiet postgres docket-neo4j docket-qdrant docket-embedder
  compose up -d --wait --wait-timeout 180
  check_http
  wait_for_inline_worker compose logs --no-color docket
  echo "✓ Compose booted the API, UI, OAuth and inline worker"

  make_worker_tls worker
  overrides=(-f "$dir/compose.worker.yaml" --profile split-worker)
  # Repeat the bootstrap against the same volume before replacing the inline worker.
  compose run --no-deps --rm -T bootstrap
  compose up -d --wait --wait-timeout 180
  check_http
  compose exec -T docket /nodejs/bin/node -e \
    "fetch('https://worker:8443').then(r => process.exit(r.status === 404 ? 0 : 1), () => process.exit(1))"
  echo "✓ Compose re-used Postgres and reached the split worker over TLS"
else
  if ! kind get clusters 2>/dev/null | grep -qx "$cluster"; then
    export KUBECONFIG="$scratch/kubeconfig"
    kind create cluster --name "$cluster" --wait 120s
    created=1
  fi
  kind load docker-image "$image" --name "$cluster"
  command kubectl --context "kind-$cluster" create namespace "$namespace"
  kubectl create secret generic docket-platform --from-file="kek=$scratch/secrets/kek" --from-literal="github-client-secret=$github_secret"
  cat > "$scratch/helm-values.yaml" <<'VALUES'
multiTenant:
  existingSecret: docket-platform
extraEnv:
  - name: DOCKET_GITHUB_CLIENT_SECRET
    valueFrom:
      secretKeyRef: { name: docket-platform, key: github-client-secret }
VALUES
  values=(-f "$chart/../multi-tenant-values.yaml" -f "$scratch/helm-values.yaml"
    --set-file "multiTenant.config=$config"
    --set "image.repository=${image%:*}" --set "image.tag=${image##*:}" --set image.pullPolicy=Never
    --set-string "publicUrl=$url")
  helm_run install docket "$chart" "${values[@]}" --wait --timeout 7m
  kubectl port-forward svc/docket "$port:4390" >"$scratch/forward.log" 2>&1 &
  forward=$!
  check_http
  wait_for_inline_worker kubectl logs deploy/docket
  echo "✓ Helm booted the API, UI, OAuth and inline worker"

  make_worker_tls docket-worker
  kubectl create secret generic worker-tls --from-file="tls.crt=$scratch/worker-tls/worker.crt" \
    --from-file="tls.key=$scratch/worker-tls/worker.key" --from-file="ca.crt=$scratch/worker-tls/ca.crt"
  helm_run upgrade docket "$chart" "${values[@]}" --set multiTenant.worker.enabled=true,multiTenant.worker.tlsSecret=worker-tls --wait --timeout 5m
  kill "$forward" 2>/dev/null || true
  wait "$forward" 2>/dev/null || true
  kubectl port-forward svc/docket "$port:4390" >"$scratch/forward.log" 2>&1 &
  forward=$!
  check_http
  kubectl exec deploy/docket -- /nodejs/bin/node -e \
    "fetch('https://docket-worker:8443').then(r => process.exit(r.status === 404 ? 0 : 1), () => process.exit(1))"
  echo "✓ Helm upgraded in place and reached the split worker over TLS"
fi
