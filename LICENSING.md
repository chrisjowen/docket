# Licensing

This repository holds code under two licences. Each package states its own in
its `package.json` `license` field, and every source file under `platform/`
carries an `SPDX-License-Identifier` header.

| Path | Licence | What it is |
| --- | --- | --- |
| `packages/*` (the `docket` CLI, `docket-server`, `docket-ui`, `contracts`, the public API contract `api`, `adapter-kit` and the adapters, the Claude Code plugin) | [Apache-2.0](LICENSE) | The CLI, the reusable server core, the local UI and the adapter SDK. Unchanged by the platform import. |
| `wheelhouse/` | [Apache-2.0](LICENSE) | The Wheelhouse plugin build. |
| `platform/**` (`@docket/server-platform`, `@docket/server-worker`, the `@docket/platform-*` modules and the platform's tests and docs) | [AGPL-3.0-only](platform/LICENSE) | The multi-tenant Docket server: accounts and dockets, sign-in and OAuth, the web app and its API, MCP, the worker, projections, enrichment and the canonical store. |

## What this means

- **Apache-2.0 packages stay Apache-2.0.** You can use the CLI, the server
  core, the contracts and the adapters on Apache terms, alone or in your own
  software, exactly as before. Rights already granted for released versions
  are unaffected.
- **The platform is AGPL-3.0-only.** If you run a modified version of it for
  users over a network, section 13 of the AGPL requires you to offer those
  users the Corresponding Source of your version. Running it unmodified, or
  privately, adds no obligation beyond the licence's usual terms.
- **Combined distributions.** A build that bundles the platform with Apache
  packages (an image or archive that runs `docket serve --config` in
  multi-tenant mode) carries both licences: the AGPL for the platform and the
  Apache-2.0 licence and notices for the rest. Apache-2.0 code can be
  combined into an AGPL-3.0 work; the Apache notices stay with it.
- **Third-party code** keeps its own licence. Neo4j, Qdrant, Cognee and the
  model files the platform can use run as separate services or downloads,
  under their own terms.

## Contributing

Contributions are accepted under the licence of the part of the repository
they change (inbound equals outbound), with each commit signed off under the
Developer Certificate of Origin. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
