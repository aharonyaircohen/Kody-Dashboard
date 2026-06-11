---
name: dependency-graph
description: Derive dependency structure from package manifests and lockfiles.
---

# Dependency Graph Skill

Use this skill when refreshing `.kody/reports/dependency-graph.md`.

## Model

Build graph nodes for:

- package manifests
- lockfiles
- dependency packages

Build graph edges for:

- package to lockfile
- package to production dependency
- package to development dependency
- package to peer dependency
- package to optional dependency

## Findings

Report:

- graph snapshot counts and hash
- package manifests without adjacent lockfiles
- risky dependency ranges
- dependencies declared with conflicting ranges
- duplicate package managers or lockfile shapes

## Boundaries

- Write only `.kody/reports/dependency-graph.md`.
- Do not edit dependency files.
- Do not install packages.
- Do not run package audits or upgrade commands.
