# Infrastructure Providers

Kody treats infrastructure as three separate responsibilities: servers,
deployments, and browsers.

## Current Provider

Only the Fly plugin is installed today. OpenComputer and Coolify are
intentionally not wired until they have real adapters and contract tests.

## Contracts

- Servers run Kody work on remote machines. The current Fly server flow first
  claims a warm pool machine, then spawns a fresh Fly runner on any miss.
- Deployments expose preview apps. The current Fly deployment flow creates a
  builder machine, reads status from Fly by deterministic app name, wakes
  suspended preview machines only through an explicit wake call, and destroys
  the Fly app on cleanup.
- Browsers are defined as a separate contract but have no provider yet. Kody
  should not pretend an iframe or local Playwright helper is a VM browser
  provider.

## Selection Rule

Provider selection must be explicit per area. The generic registry throws when
a caller omits the provider id or asks for an area the installed provider does
not support. Dashboard core imports the installed registry; vendor mechanics
stay inside `src/dashboard/lib/infrastructure/plugins/fly/`.
