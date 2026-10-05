<h1 align="center">docket</h1>

<h3 align="center">Your repo remembers. So does Claude.</h3>

<p align="center">
  A Claude Code plugin that gives every session your team's hard-won project knowledge,
  and quietly writes down what it learns before it forgets.
</p>

<p align="center">
  <a href="#install-in-30-seconds">Install</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#how-it-works">How it works</a>
</p>

---

## The problem

Every new Claude session starts from zero. It greps the same files, rediscovers the same
architecture, asks the same questions, and forgets the decision you explained yesterday.
Your team's knowledge lives in people's heads, stale wikis and Slack threads, none of which
an agent can read.

## The fix

**Docket** captures and classifies project knowledge as plain Markdown in your repository, under
`.docket/`: services, decisions, constraints, owners and dependencies, each one a file with
a typed identity and links to the others. The plugin teaches Claude to **read it first** and
to **keep it current**.

- 🧠 **Context from the first message.** Every session starts knowing where the docket lives and
  how to search it, so Claude asks the repo instead of guessing.
- 🔎 **Search before grep.** `docket search` asks every projection at once (semantic
  vectors, a knowledge graph, full text) and points straight at the canonical file.
- ✍️ **Knowledge captured as you work.** When a session settles a decision or uncovers a
  constraint, it gets written down. The end-of-session review runs **in the background**,
  so it never interrupts you.
- 📐 **Structured, not a junk drawer.** Your repo defines its own ontology in
  `.docket/entities.yaml`. Claude follows it, and extends it deliberately when something
  new doesn't fit.
- 🤝 **Humans and agents share one source of truth.** The docket is reviewed in pull requests,
  merged like code and owned by the team. There's no hidden vector store to trust blindly.
- 🔒 **Local-first.** Nothing leaves your machine unless you configure a projection that
  sends it.

## Install in 30 seconds

```text
/plugin marketplace add chrisjowen/docket
/plugin install docket@docket
```

Then add the CLI to the repository you want to remember things:

```bash
pnpm add -D @chrisjowen/docket
npx docket init
```

That's it. Open a session and ask Claude about your system.

<details>
<summary>Developing the plugin locally</summary>

```text
/plugin marketplace add /path/to/docket
/plugin install docket@docket
```

Bump the version in `.claude-plugin/plugin.json` and the root
`.claude-plugin/marketplace.json` when you release. `/plugin update` compares versions, so
an unbumped change never reaches installed copies.

</details>

## What you get

| Piece | What it does |
|---|---|
| **`docket` skill** | Using the `docket` CLI: search, ontology, validate, sync |
| **`remember` skill** | Writing to the docket well: procedure, file format, what's worth keeping |
| **`ontology` skill** | Inspecting and extending `.docket/entities.yaml` |
| **SessionStart hook** | Injects docket context and runs a best-effort `docket sync` |
| **Stop hook** | Starts a background review of new transcript lines and captures durable knowledge in `.docket/` |

### The background review

When a session has grown by enough since the last review, the Stop hook starts a detached,
headless `claude -p` and returns straight away. The review agent:

- reads only the transcript lines added since the last review
- follows the `remember` skill and checks the existing docket before writing
- can only read, run `docket`, and edit files under `.docket/`
- runs one at a time per repository, so two reviews never race on the same files

Logs land in `~/.cache/docket/reviews/`. Set `DOCKET_REVIEW_MODEL` to choose the
model it runs on.

## How it works

```
   you + Claude                     .docket/**/*.md            docket watch / sync
  ──────────────  edit Markdown ──►  canonical, in git   ──►   ┌─ vectors (mem0)
   skills + hooks                    typed by ontology         ├─ knowledge graph
                                                               └─ jsonl index
                                         ▲                            │
                                         └──── docket search ◄────────┘
```

The plugin owns **agent behaviour** only. Indexing, file watching and projections belong to
the `docket` CLI (`@chrisjowen/docket`), a separate package. Agents never write to an index;
they edit the same Markdown a human would, and `docket watch` does the rest. Edits from
Claude, from people, from scripts, from `git pull` and from merges all take the same path.

Without the CLI installed the skills still work, because the Markdown files are the source
of truth either way.

### Recommended `package.json` scripts

```json
{
  "devDependencies": {
    "@chrisjowen/docket": "^0.1.0"
  },
  "scripts": {
    "docket:watch": "docket watch",
    "docket:sync": "docket sync",
    "docket:validate": "docket validate"
  }
}
```

Run `npm run docket:watch` while you work, and `docket validate --strict` in CI.

---

<p align="center">
  <b>Stop re-explaining your codebase.</b><br>
  <code>/plugin install docket@docket</code>
</p>
