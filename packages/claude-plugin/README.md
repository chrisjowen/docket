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
- ✍️ **Evidence collected as you work, without being asked.** When a session settles a
  decision, uncovers a constraint or reads code that shows a dependency, it gets written
  down, and what the docket already knows gains another sighting. Reviews run **in the
  background** on a small model as the session goes, so they never interrupt you.
- 📐 **Structured, not a junk drawer.** Your repo defines its own ontology in
  `.docket/entities.yaml`. Claude follows it, and extends it deliberately when something
  new doesn't fit.
- 🤝 **Humans and agents share one source of truth.** The docket is reviewed in pull requests,
  merged like code and owned by the team. There's no hidden vector store to trust blindly.
- 🔒 **Local-first.** Nothing leaves your machine unless you configure a projection that
  sends it.

## Install in 30 seconds

From the root of the repository you want to remember things:

```bash
npx @chrisjowen/docket setup
```

That installs the plugin, sets up `.docket/` in the repository if it has none,
and offers to put the `docket` CLI on your path. Restart Claude Code, open a
session and ask Claude about your system. Running it again updates what is
installed; `--yes` answers every question with the recommended answer, and
without a terminal nothing is asked at all.

**For the whole team:** `npx @chrisjowen/docket setup --team` installs the plugin
for the repository instead, in `.claude/settings.json`. Commit that file and
everyone who clones the repository is offered the plugin.

**Just the plugin,** from inside Claude Code:

```text
/plugin marketplace add chrisjowen/docket
/plugin install docket@docket
```

No separate CLI install is needed. The plugin puts `docket` on Claude's path:
it runs the repository's own CLI, or one on your path, and otherwise the CLI
release the plugin pins, through `npx` (Node 22 or later). Set up a
repository with `npx @chrisjowen/docket init`.

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
| **`remember` skill** | Writing to the docket well: when to capture unasked, procedure, file format, evidence, what's worth keeping |
| **`ontology` skill** | Inspecting and extending `.docket/entities.yaml` |
| **`docket` on the path** | The plugin's `bin/docket`: the project's or your CLI, else the pinned release through `npx` |
| **SessionStart hook** | Injects docket context, including when to capture without being asked, and starts a best-effort `docket sync` in the background |
| **Stop, PreCompact and SessionEnd hooks** | Start a background review of the unreviewed part of the session, which collects evidence into `.docket/` |

### Capturing without being asked

The docket is an evidence collector, so Claude does not wait for "remember this". The
session-start context and the `remember` skill tell it to capture, at a natural pause in
the task and with a one-line note of what it wrote, whenever:

- you state a decision, constraint, convention or owner
- it settles a decision or uncovers a constraint
- code, config or infrastructure it reads shows a resource or dependency the docket
  lacks, or confirms or contradicts one it has

It searches first and adds evidence to what the docket already has rather than writing
another file, and records each place once per session, so captures do not pile up as
duplicates. Whatever the session itself does not capture, the background review does.

### The background review

A detached, headless `claude -p` collects evidence from the session transcript as the
session goes. The hooks start one and return straight away:

- **after a turn** (Stop), once the session has grown by 200 transcript lines since the
  last review
- **before compaction** (PreCompact), for whatever is unreviewed
- **at session end** (SessionEnd), for the tail

A turn or compaction does not queue a review while one of the same session is still
queued or running; the next one picks up what it did not cover. The review agent:

- reads only the transcript lines no earlier review has seen, so a resumed session is
  reviewed from where the last review stopped, and nothing is reviewed twice
- records what the session saw - the resources in the files it read, the commands it ran
  and the URLs it opened, their relationships, and the decisions, constraints and
  conventions it settled - not only what it set out to change
- follows the `remember` skill and checks the existing docket before writing
- records where everything it captures was seen - the file, lines and symbol, the
  config key, the API endpoint, the URL, or what you said - with the session and date
- appends a new sighting to what is already there instead of rewriting it, so
  confidence grows as independent evidence arrives
- never captures credentials, secrets, tokens, private keys or passwords
- can only read, run `docket` and read-only `git rev-parse` / `git remote get-url`,
  and edit files under `.docket/`; its `docket` is the plugin's own, so it finds
  the project's or your CLI, or runs the pinned release through `npx`
- runs one at a time per repository: a session that ends while another review is
  running is reviewed once that one finishes
- leaves no session behind in your `/resume` list

Lines count as reviewed only once a review succeeds, so a missing, signed-out or failing
`claude` leaves them for the next review of that session. A session in which you never
typed a prompt is not reviewed at all. Logs land in `~/.cache/docket/reviews/`.

**Cost.** One review per 200 transcript lines or so, plus one at the end, on Claude
Haiku by default; a short session gets just the one at the end. Each reads its stretch
of the transcript plus `.docket/entities.yaml` (the default ontology is about 40 KB), so
a review typically reads tens of thousands of tokens. Every transcript line is read
once, so a long session costs a few more ontology reads than it did with a single
review, not a re-read of the whole session. At Haiku's $1 per million input tokens that
is a few cents per review; on a subscription it counts towards your usage like any other
Claude Code session.

**Model.** Set `DOCKET_REVIEW_MODEL` to any model name or alias `claude --model`
accepts, for example `DOCKET_REVIEW_MODEL=sonnet`.

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

Without the CLI installed the plugin runs the release it pins through `npx`, and without
`npx` the skills still work, because the Markdown files are the source of truth either way.

### Recommended `package.json` scripts

```json
{
  "devDependencies": {
    "@chrisjowen/docket": "^0.3.0"
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
  <code>npx @chrisjowen/docket setup</code>
</p>
