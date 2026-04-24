/**
 * Default scaffold for a new mission's markdown body.
 * Sections are locked early so the body stays parseable for future enforcement
 * (e.g. extracting the allowed command list to gate what the mission can do).
 */
export const MISSION_TEMPLATE = `## Mission
<!-- One paragraph: what is this mission responsible for? Keep the intent crisp. -->

## System Prompt
<!-- How should this mission behave when invoked? Tone, priorities, defaults. -->

## Allowed Commands
<!-- The kody commands this mission is authorised to run on GitHub. -->
- kody <command>

## Restrictions
<!-- Hard no-go constraints. What must this mission never do? -->
-
`
