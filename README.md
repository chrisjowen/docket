# Team Memory

Local-first team memory for software repositories.

Canonical memory is plain Markdown files with YAML frontmatter, committed to the
repo under `.memory/`. Everything else — indexes, graphs, caches — is a
disposable projection that can be deleted and rebuilt:

```bash
rm -rf .memory/.index
memory rebuild
```

A repo-defined ontology at `.memory/entities.yaml` says what resource types and
relationships mean. Humans and agents edit the same files.

Status: in development. See [`PLAN.md`](PLAN.md) and [`docs/SPEC.md`](docs/SPEC.md).
