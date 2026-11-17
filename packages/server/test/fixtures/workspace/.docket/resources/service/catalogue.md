---
id: service.catalogue
type: service
title: Catalogue
attributes:
  tier: standard
links:
  - rel: depends_on
    target: datasource.catalogue-db
  - rel: depends_on
    target: service.search
  - rel: owned_by
    target: team.discovery
---
Products, prices and stock.
