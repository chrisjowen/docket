<p align="center">
  <img src="https://raw.githubusercontent.com/chrisjowen/docket/main/docs/assets/docket-hero.svg" alt="A manila case file labelled .docket/ holding a Markdown exhibit stamped EVIDENCE, beside a cork board of exhibit cards joined by red string" width="100%">
</p>

# @chrisjowen/docket

The casebook of evidence for your repository. Each fact about your system is an
exhibit: a typed Markdown file under `.docket/` whose claims cite where they were
seen - file and lines, manifest key, URL or conversation - and docket weighs that
evidence into a confidence score. The files are the record; indexes, vectors and
graphs are disposable projections rebuilt from them.

```text
.docket.yaml                config: where the case file lives, which adapters to feed
.docket/entities.yaml       the ontology: resource types, relationships, evidence sources
.docket/resources/...       exhibits, one Markdown file per service, team, datasource...
.docket/decisions/          decisions and why
.docket/constraints/        rules the system must obey
.docket/.index/             projections: generated, gitignored, disposable
.docket/.cache/             answers docket open's chat cached: gitignored, disposable
```

Install the Claude Code plugin and set up the repository you are in, in one
command (`--team` installs the plugin for everyone who clones the repository):

```bash
npx @chrisjowen/docket setup
```

Or use the CLI on its own:

```bash
npm install --save-dev @chrisjowen/docket
npx docket init                 # scaffold .docket.yaml, .docket/ and the default ontology
npx docket validate --strict    # check files against the ontology
npx docket sync                 # project changed files into .docket/.index
npx docket watch                # reconcile continuously as files change
npx docket search <query...>    # ask every searchable projection
npx docket open                 # browse, search, ask and chat in a web UI, served on all interfaces
npx docket ontology list        # what resource types and relationships exist
npx docket adapter add neo4j    # set up an adapter: asks, shows the plan, applies it once confirmed
```

Requires Node 22 or later. The jsonl, mem0 and Neo4j adapters ship with the
package; mem0 and Neo4j projections also need the optional `mem0ai` and
`neo4j-driver` packages installed next to it, which `docket adapter add` offers
to install.

![docket open: the relationship graph with an exhibit's evidence and confidence](https://raw.githubusercontent.com/chrisjowen/docket/main/docs/assets/docket-open.png)

Documentation, the file format and the Claude Code plugin:
<https://github.com/chrisjowen/docket>
