# ghcr.io/chrisjowen/docket: the docket CLI with both server runtimes, running
# `docket serve` by default. Build from the repository root:
#
#   docker build -f deploy/image/Dockerfile -t ghcr.io/chrisjowen/docket:dev .
#
# It builds the workspace from source, packs @chrisjowen/docket and
# @chrisjowen/docket-server as npm would publish them, installs those with the
# drivers docket's opt-in stores need (pg, better-sqlite3, neo4j-driver,
# mem0ai), and copies the result onto a distroless Node image: no shell, no
# package manager, running as nonroot (65532).

FROM node:22-trixie-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /src
# The store from the lockfile alone, so a source change does not refetch it.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline \
 && pnpm build \
 && mkdir /pack \
 && (cd packages/docket && npm pack --ignore-scripts --pack-destination /pack) \
 && (cd packages/server && npm pack --ignore-scripts --pack-destination /pack) \
 && mv /pack/chrisjowen-docket-server-*.tgz /pack/docket-server.tgz \
 && mv /pack/chrisjowen-docket-*.tgz /pack/docket.tgz \
 && pnpm --filter @docket/server-platform deploy --legacy --prod /platform

# The packed packages and the store drivers, installed as npm installs them for
# a user. better-sqlite3 uses its prebuilt binary, or compiles with the
# toolchain here.
FROM node:22-trixie-slim AS runtime
RUN apt-get update -qq \
 && apt-get install -qq -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/docket
COPY --from=build /pack/ /pack/
COPY deploy/image/package.json ./
# --legacy-peer-deps: mem0ai lists every vector store and model SDK it can
# use as a peer; the image carries only Qdrant's client and Ollama's.
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund \
 && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src node_modules/better-sqlite3/build/Release/obj* \
 && mkdir -p /skel/data/docket /skel/data/state
COPY deploy/image/docket /opt/docket/bin/docket
COPY --from=build /platform /opt/docket/platform
RUN mkdir -p node_modules/@docket \
 && ln -s ../../platform node_modules/@docket/server-platform

FROM gcr.io/distroless/nodejs22-debian13:nonroot
LABEL org.opencontainers.image.title="docket" \
      org.opencontainers.image.description="docket serve: the self-hosted Docket server" \
      org.opencontainers.image.source="https://github.com/chrisjowen/docket" \
      org.opencontainers.image.licenses="Apache-2.0 AND AGPL-3.0-only"
COPY --from=runtime /opt/docket /opt/docket
COPY LICENSE /opt/docket/licenses/Apache-2.0.txt
COPY platform/LICENSE /opt/docket/licenses/AGPL-3.0-only.txt
COPY LICENSING.md /opt/docket/licenses/LICENSING.md
COPY deploy/image/bootstrap-postgres.mjs /opt/docket/bootstrap-postgres.mjs
COPY --from=runtime --chmod=0755 /opt/docket/bin/docket /usr/local/bin/docket
# /data/docket: the workspace's project (its documents and ontology).
# /data/state: the server's own state (tokens, the audit log, a Postgres
# server's projections). A new named volume at /data starts with both,
# owned by nonroot.
COPY --from=runtime --chown=65532:65532 /skel/data /data
ENV NODE_ENV=production \
    DOCKET_SERVE_HOST=0.0.0.0 \
    DOCKET_SERVE_PORT=4390 \
    DOCKET_DATA_DIR=/data/state
WORKDIR /data/docket
EXPOSE 4390
USER nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch(`http://127.0.0.1:${process.env.DOCKET_SERVE_PORT||4390}/healthz`).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["docket"]
CMD ["serve"]
