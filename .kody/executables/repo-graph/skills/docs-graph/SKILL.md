---
name: docs-graph
description: Derive documentation topology from markdown files.
---

# Docs Graph Skill

Use this skill when refreshing `.kody/reports/docs-graph.md`.

## Model

Build graph nodes for:

- markdown documents
- external domains
- missing local link targets

Build graph edges for:

- document to linked document
- document to linked external domain
- document to missing local target

## Findings

Report:

- graph snapshot counts and hash
- broken local links
- markdown files without an H1
- docs with TODO/FIXME markers
- orphan docs with no incoming or outgoing links

## Boundaries

- Write only `.kody/reports/docs-graph.md`.
- Do not edit docs.
- Do not fetch external links.
- Do not move, rename, or delete files.
