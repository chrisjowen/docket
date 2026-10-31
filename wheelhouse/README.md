# docket's Wheelhouse plugin

This folder makes the docket repository a
[Wheelhouse](https://github.com/chrisjowen/wheelhouse) plugin. Its **Docket**
project tab is the casebook `docket open` serves, the same UI code drawn
inside Wheelhouse's page: Browse, Ask, Adapters, the inspector, chat, quick
search and sync.

```sh
wheelhouse plugin install chrisjowen/docket
```

Wheelhouse fetches the repository at a commit, shows what the plugin adds (its
tab, its `viewer` service and its MCP app server, `docket`) and asks before it
keeps it. Restart Wheelhouse to load it. Installing needs no
build: the built files are committed, the docket the plugin runs among them
(see [The docket it runs](#the-docket-it-runs)).

A Wheelhouse that still has its own Docket plugin built in (the read-only
Chart) refuses an installed plugin with the same name, `docket`, until that
built-in one is removed.

## What it shows

It is on for every project whose clone has `.docket.yaml`.

| Slot          | Element             | What it is                                                             |
| ------------- | ------------------- | ---------------------------------------------------------------------- |
| `project.tab` | `<docket-casebook>` | **Docket**, at `/projects/<id>/docket/casebook`: the project's casebook |

The casebook reads everything from, and asks everything of, the project's
docket viewer: `docket open`, declared as the plugin's `viewer` service.
Until the viewer answers, the tab says so, with **Launch** (Wheelhouse starts
it, then opens docket's own page in a new tab, as it does for every plugin
service) and the command that starts it by hand. Wheelhouse starts it on
127.0.0.1, on a port of its own per project, with the docket the plugin ships
and Wheelhouse's own node, as

```sh
<node> <plugin>/wheelhouse/docket/dist/cli.js open --host 127.0.0.1 --port <port> --no-open \
  --allow-origin http://127.0.0.1:4310 --allow-origin http://localhost:4310
```

where `<plugin>` is where Wheelhouse installed the plugin
(`~/.wheelhouse/plugins/docket`).

`--allow-origin` lets Wheelhouse's page use the viewer's API: read its
answers, ask, and sync with the token the viewer hands it. A viewer started
by hand without it serves docket's own page only, and the tab says to stop it
and launch it from Wheelhouse.

### docket's MCP server

The viewer is also docket's MCP server. The plugin declares it as `docket`,
on the `viewer` service at `/mcp`:

```json
"mcpServers": [{ "id": "docket", "service": "viewer" }]
```

Its one tool, `docket_search` (read-only, given a `query` and the Wheelhouse
`project` it routes by), returns the resources a search of the project's docket finds, as text and as
`docket-search.v1` structured content. Its app, `ui://docket/search.html`
(`text/html;profile=mcp-app`, no network), draws them, the subgraphs the
projections returned and the resources one link away on the casebook's
evidence board. From the app you can search again,
pick a resource to see its file and links, open it in docket's own page, or go
full screen. The plugin draws the app in no slot of its own; it is there for
whatever in Wheelhouse calls `docket_search` for a project. The viewer must be
running, as for the tab. [`docs/mcp.md`](../docs/mcp.md) is the tool's
contract.

Agents learn to search a project's docket from docket's Claude Code plugin
(`packages/claude-plugin`). Its session-start hook tells a session outside
any docket, such as Firstmate's, to search the docket of a project it is
asked about. The hook comes with the plugin and goes with it, and writes
nothing to any project's files.

The element draws in its own shadow root. docket's styles stay inside it;
Wheelhouse's colour variables reach in, so the casebook follows Wheelhouse's
light and dark themes, with docket's own spine and graph colours.

### Parity with `docket open`

Every view and action of docket open's page, inventoried from
`packages/docket-ui`:

| docket open                                                                                                        | In Wheelhouse                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Header: project name, exhibit and relationship counts                                                              | Same                                                                                                    |
| Validation findings (the header's count, and the list it opens)                                                    | Same                                                                                                    |
| **Browse › Graph**: the force-directed board, type icons and colours, zoom and fit, ghosts for unresolved links    | Same                                                                                                    |
| The index beside the graph: type and relationship filters with All / None, unresolved links, search-index status   | Same, with its **sync now** link                                                                        |
| **Browse › Table**: exhibits or observations, sorted, filtered by text, type, source, date observed and assessment | Same                                                                                                    |
| **Browse › History**: dated observations (`eventAt` and `observedAt` apart) and `supersedes` chains                | Same                                                                                                    |
| **Inspector**: an exhibit's frontmatter, notes, links in and out, confidence, sources and evidence                 | Same                                                                                                    |
| Evidence inspector: an answer's evidence, resolved against the files when clicked (`POST /api/evidence`)           | Same                                                                                                    |
| **Chat** beside every view: questions summarized by a model, citations, the cited exhibits on the board            | Same                                                                                                    |
| **Quick search** (`⌘K`, `Ctrl-K` or `/`): type-ahead over exhibits and relationships, `type:` `rel:` `tag:`        | Same; the shortcuts work anywhere on the tab's page that is not a text field                           |
| A board scoped to an answer, with **Show all exhibits**; a picked relationship                                     | Same                                                                                                    |
| **Ask**: one question to the adapters, choosing which, with or without a summary, every result block, cancelling   | Same                                                                                                    |
| **Adapters**: each instance's roles, health and freshness, refreshed on request                                    | Same                                                                                                    |
| **Sync**: every adapter or one, progress per adapter, when each last synced, one at a time                         | Same; the viewer accepts it from Wheelhouse's page because it was started with `--allow-origin` for it |
| **Reload from the files**, and a reload when the window regains focus                                              | Same                                                                                                    |
| Collapsing and opening the inspector                                                                               | Same                                                                                                    |
| The light and dark switch                                                                                          | Wheelhouse's own: the casebook follows Wheelhouse's theme                                               |
| Each view and the selected exhibit in the address (`/ask`, `#<id>`), so a reload or a link keeps them              | Kept while the tab is open; the page's address is Wheelhouse's, so it does not carry them              |

## The docket it runs

The plugin ships the docket it runs: `wheelhouse/docket/` is docket's CLI
built from the plugin's own commit (`packages/docket/dist`, as npm would have
it: the CLI, the web UI `docket open` serves, docket_search's app, the
ontologies and the adapters docket ships), with the npm packages it imports
bundled into `dist/vendor/`. Wheelhouse installs and updates a plugin by
fetching its repository, with no build and no `npm install`, so these files
are committed, and the viewer and its MCP server are always the docket the
plugin was built with. Installing or updating the plugin
(`wheelhouse plugin update docket`, or **Update** in Settings → Plugins) brings
the matching docket; nothing is installed globally, and the `docket` on your
`PATH` is left alone.

Wheelhouse runs it with the node it runs on itself, which, like docket, is
Node 22 or later, and asks it nothing before starting it: it is the plugin's
own commit. docket's optional drivers (`neo4j-driver`, `mem0ai`) are not
shipped, and the docket shipped with the plugin does not load one installed in
the project. To use one, set `bin` to a docket that has the driver installed
beside it: an absolute path to the project's own `node_modules/.bin/docket`
after the project installs docket, or the global docket with the driver
installed next to it. `bin` is one plugin-wide setting, so it applies to every
project.

The tab says which docket the viewer runs (`Runs docket 0.5.0, shipped with
this plugin.`) while the viewer is not open, and its problems name it too.

## Settings

In Wheelhouse's `plugins.json`, all optional:

```json
{
  "plugins": {
    "docket": {
      "settings": {
        "bin": "/abs/path/to/docket",
        "roots": { "wheelhouse": "/abs/path/to/docket/examples/acme-platform" },
        "ports": { "wheelhouse": 4400 },
        "origins": ["http://127.0.0.1:4310", "http://localhost:4310"]
      }
    }
  }
}
```

- `bin` is a docket CLI to run instead of the one the plugin ships: an
  absolute path, or a command name looked up on `PATH` (`"docket"` for the
  one installed there). The plugin asks it `docket --version` and
  `docket open --help`; the tab names the version it says, and a docket whose
  `docket open` has no `--allow-origin` is too old, and the tab says so.
  Without `bin` the plugin runs the docket it ships.
- `roots` shows another docket for a project, such as docket's
  `examples/acme-platform`; turn the plugin on for that project with
  `"projects": { "<id>": true }`.
- `ports` sets a project's viewer port. Otherwise Wheelhouse picks one the
  first time, starting from a port between 4381 and 4780 worked out from the
  project id, and keeps it.
- `origins` are the Wheelhouse pages the viewer lets in: http(s) on
  127.0.0.1, localhost or [::1]. Set it when Wheelhouse runs on another port
  (`wheelhouse open --port`, or its dev server); the tab says which origin to
  add. A viewer already running keeps the pages it was started with, so stop
  it and launch it again after changing them.

## How it reads docket

The server entry never runs anything that writes. Its provider reads whether
the clone has `.docket.yaml` and which docket the viewer runs: the one the
plugin ships, whose version its `package.json` says, or the `bin` the settings
name, which it asks `docket --version` and `docket open --help` (whether it can
allow Wheelhouse's page). Its service works out the viewer's command, port
and health check; its MCP server is the viewer's `/mcp`. Wheelhouse checks the viewer by `GET /api/health`, whose
`root` must be the project's docket. Everything else the casebook does goes to
the viewer, as on docket open's own page: its writes are chat's answer cache
and, when you sync, the projections.

## Layout

```
.wheelhouse-plugin/plugin.json   the manifest: id, version, contract, entries, enable rule, slot, service, MCP server
wheelhouse/server/index.js       the server entry Wheelhouse imports (built from src/server.ts)
wheelhouse/ui/index.js           <docket-casebook> (built from packages/docket-ui/src/embed)
wheelhouse/docket/               the docket the plugin runs (copied from packages/docket/dist)
wheelhouse/src/                  the server entry's source and the plugin's tests
wheelhouse/build.mjs             bundles the first two with esbuild and Vite, and copies the third
```

The element is docket-ui itself: `packages/docket-ui/src/embed` mounts the
casebook shell (`src/lib/components/casebook.svelte`) that docket open's page
also draws, with the viewer's address as its API and its views kept in
memory, built by `packages/docket-ui/vite.embed.config.ts`.

## Build and test

```sh
pnpm build                  # at the root: docket, which docket/ is copied from
pnpm -C wheelhouse build    # write server/index.js, ui/index.js and docket/
pnpm -C wheelhouse check    # fail when they differ from what the sources build
pnpm -C wheelhouse test     # check, then the server entry's and the element's tests
```

Commit the built files with the sources, after any change to docket, its web
UI or its adapters as well as to the plugin. Bump `version` in
`.wheelhouse-plugin/plugin.json` with `packages/docket/package.json`; a test
checks that they agree. The test that starts a real viewer runs the docket the
plugin ships.
