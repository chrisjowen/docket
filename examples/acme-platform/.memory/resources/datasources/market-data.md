---
id: datasource.market-data
type: datasource
title: Market Data Tables

attributes:
  zone: restricted

links:
  - rel: owned_by
    target: team.research-platform

  - rel: uses
    target: system.databricks
---

# Market Data Tables

Licensed third-party market data landed into Databricks Delta tables. The
licence forbids redistribution, which is why the Research Assistant reads them
in place rather than exporting extracts.
