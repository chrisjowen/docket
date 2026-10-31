---
id: decision.docket-search-board-draws-adapter-subgraphs
type: decision
title: docket_search draws the subgraphs adapters return, with canonical neighbours as faded context

tags:
  - mcp
  - docket-search
  - graph

links:
  - rel: uses
    target: decision.docket-open-serves-docket-search-mcp-app
    evidence:
      - source: code
        path: packages/docket/src/mcp/search.ts
        symbol: searchGraph
        note: The docket_search board is filled with the matches, then each answering adapter's graph-block nodes, edges and paths (via adapter), then canonical one-hop neighbours and declared links (via canonical), up to MAX_NODES.
        observedAt: 2026-10-31
        observedBy: claude
        session: 29d20822-5a35-4f89-ab0c-e01f6f705eec

evidence:
  - source: conversation
    note: "The captain chose option A (subgraph end to end) from the docket-neo4j-native-search scout report, with board policy (a): the adapter's subgraph at full strength and canonical one-hop neighbours shown faded as context. A1 lands this in core; A2 (Neo4j's default path answering with one native ranked subgraph) is a later change."
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: code
    path: packages/docket/src/query/legacy.ts
    symbol: toSearchResult
    note: toSearchResult now carries each adapter's graph blocks as SourceResult.graph, nodes mapped to canonical entity ids when they name one, each edge with its confidence and the text of the evidence it cites; before, it kept only entities blocks.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: code
    path: packages/docket-ui/src/mcp-app/board.ts
    symbol: boardOf
    note: When any adapter returned a subgraph, the app fades nodes and links with via canonical; when none did, nothing fades, as before.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec
  - source: docs
    path: docs/mcp.md
    note: The docket-search.v1 contract gains optional via, foundBy, confidence, why and paths, without a schema rename.
    observedAt: 2026-10-31
    observedBy: claude
    session: 29d20822-5a35-4f89-ab0c-e01f6f705eec

provenance:
  capturedBy: claude
---

# docket_search draws the subgraphs adapters return

The `docket_search` board (and `docket search`) used to keep only each
adapter's entity hits and add every canonical one-hop neighbour of them,
drawing the links the files declare between all of these. An adapter's own
subgraph - a Neo4j traversal's path, say - was dropped. That went against
`docs/adapter-spec.md` §13: a graph view highlights returned subgraphs or
paths, not relationships guessed between arbitrary hits.

Now the graph blocks an adapter returns reach the board: their nodes, their
edges with who returned them, their confidence (the optional, additive
`GraphEdge.confidence`) and the evidence each cites as its "why", and the
paths the adapter used. They are drawn at full strength. The canonical one-hop
neighbours of the matches and the links the files declare stay on the board as
context, marked `via: canonical`, and the app fades them whenever some
adapter returned a subgraph. For adapters that return no graph block (JSONL,
mem0, memvid, MemPalace today) the board is unchanged and nothing fades.

The structured content stays `docket-search.v1`: every new field is
additive, so Wheelhouse's chat card and other readers keep working. Edges are
merged on (source, rel, target) across adapters; no edge is invented between
two adapters' nodes. Neo4j's model-written Cypher path already returns graph
blocks, so its subgraphs show at once; making Neo4j's default path return one
is a separate, later change.
