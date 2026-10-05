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
- 🔎 **Search before grep.** `docket search` asks every projection at once and points
  straight at the canonical file. Out of the box that is a keyword index; configure
  mem0 or Neo4j and it asks semantic vectors or a knowledge graph as well.
- ✍️ **Knowledge captured as you work.** When a session settles a decision or uncovers a
  constraint, it gets written down. The end-of-session review runs **in the background**
  on a small model, so it never interrupts you.
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
| **SessionStart hook** | Injects docket context and starts a best-effort `docket sync` in the background |
| **SessionEnd hook** | Starts a background review of the session and captures durable knowledge in `.docket/` |

### The background review

When a session ends, the SessionEnd hook starts a detached, headless `claude -p` and
returns straight away. The review agent:

- reads only the transcript lines no earlier review has seen, so a resumed session is
  reviewed from where the last review stopped, and nothing is reviewed twice
- follows the `remember` skill and checks the existing docket before writing
- never captures credentials, secrets, tokens, private keys or passwords
- can only read, run `docket`, and edit files under `.docket/`; the project's own
  `node_modules/.bin` is put first on its `PATH`, so a dev-dependency install works
- runs one at a time per repository: a session that ends while another review is
  running is reviewed once that one finishes
- leaves no session behind in your `/resume` list

Lines count as reviewed only once a review succeeds, so a missing, signed-out or failing
`claude` leaves them for the next time that session ends. A session in which you never
typed a prompt is not reviewed at all. Logs land in `~/.cache/docket/reviews/`.

**Cost.** One review per session, on Claude Haiku by default. Its input is the
unreviewed part of the transcript plus `.docket/entities.yaml` (the default ontology is
about 40 KB), so a review typically reads tens of thousands of tokens, and more after a
long session. At Haiku's $1 per million input tokens that is a few cents per session;
on a subscription it counts towards your usage like any other Claude Code session.

**Model.** Set it per repository in `.docket.yaml`, or per machine with
`DOCKET_REVIEW_MODEL`, which wins:

```yaml
review:
  model: sonnet   # any model name or alias `claude --model` accepts
```

Set `DOCKET_REVIEW=1` in the environment to turn the review off.

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
