# docket's Wheelhouse plugin

This folder makes the docket repository a
[Wheelhouse](https://github.com/chrisjowen/wheelhouse) plugin. Its **Docket**
project tab is the casebook `docket open` serves, the same UI code drawn
inside Wheelhouse's page: Browse, Ask, Adapters, the inspector, chat, quick
search and sync.

```sh
wheelhouse plugin install chrisjowen/docket
```

Wheelhouse fetches the repository at a commit, shows what the plugin adds and
asks before it keeps it. Restart Wheelhouse to load it. Installing needs no
build: the built files are committed.

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
127.0.0.1, on a port of its own per project, as

```sh
docket open --host 127.0.0.1 --port <port> --no-open \
  --allow-origin http://127.0.0.1:4310 --allow-origin http://localhost:4310
```

`--allow-origin` lets Wheelhouse's page use the viewer's API: read its
answers, ask, and sync with the token the viewer hands it. A viewer started
by hand without it serves docket's own page only, and the tab says to stop it
and launch it from Wheelhouse.

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

- `bin` is the docket CLI; otherwise `docket` on `PATH`. A docket whose
  `docket open` has no `--allow-origin` is too old, and the tab says so.
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
the clone has `.docket.yaml` and asks `docket open --help` whether this docket
can allow Wheelhouse's page; its service works out the viewer's command, port
and health check. Wheelhouse checks the viewer by `GET /api/health`, whose
`root` must be the project's docket. Everything else the casebook does goes to
the viewer, as on docket open's own page: its writes are chat's answer cache
and, when you sync, the projections.

## Layout

```
.wheelhouse-plugin/plugin.json   the manifest: id, version, contract, entries, enable rule, slot, service
wheelhouse/server/index.js       the server entry Wheelhouse imports (built from src/server.ts)
wheelhouse/ui/index.js           <docket-casebook> (built from packages/docket-ui/src/embed)
wheelhouse/src/                  the server entry's source and the plugin's tests
wheelhouse/build.mjs             bundles both with esbuild and Vite
```

The element is docket-ui itself: `packages/docket-ui/src/embed` mounts the
casebook shell (`src/lib/components/casebook.svelte`) that docket open's page
also draws, with the viewer's address as its API and its views kept in
memory, built by `packages/docket-ui/vite.embed.config.ts`.

## Build and test

```sh
pnpm -C wheelhouse build    # write server/index.js and ui/index.js
pnpm -C wheelhouse check    # fail when they differ from what the sources build
pnpm -C wheelhouse test     # check, then the server entry's and the element's tests
```

Commit the built files with the sources. Bump `version` in
`.wheelhouse-plugin/plugin.json` with `packages/docket/package.json`; a test
checks that they agree. The test that starts a real viewer runs the built CLI,
so run `pnpm build` at the root first.
