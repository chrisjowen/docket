# @chrisjowen/docket

Capture and classify project knowledge as typed Markdown in your repository.
Files under `.docket/` are the source of truth; indexes, vectors and graphs are
disposable projections rebuilt from them.

```bash
npm install --save-dev @chrisjowen/docket
npx docket init                 # scaffold .docket.yaml, .docket/ and the default ontology
npx docket validate --strict    # check files against the ontology
npx docket sync                 # project changed files into .docket/.index
npx docket watch                # reconcile continuously as files change
npx docket search <query...>    # ask every searchable projection
npx docket ontology list        # what resource types and relationships exist
```

Requires Node 22 or later. mem0 and Neo4j projections need the optional
`mem0ai` and `neo4j-driver` packages.

Documentation, the file format and the Claude Code plugin:
<https://github.com/chrisjowen/docket>
