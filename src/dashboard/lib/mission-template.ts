/**
 * Default scaffold for a new mission's markdown body.
 *
 * Every placeholder is an HTML comment so the author never has to delete
 * anything to write real content — comments are invisible in the rendered
 * preview, and the H2 section skeleton stays parseable for future enforcement
 * (e.g. extracting the allowed command list to gate what the mission can do).
 */
export const MISSION_TEMPLATE = `## Mission
<!-- One paragraph: what is this mission responsible for? Keep the intent crisp. -->

## System Prompt
<!-- How should this mission behave when invoked? Tone, priorities, defaults. -->

## Allowed Commands
<!-- One kody command per line as a bullet, e.g. "- kody plan". Leave empty to deny all. -->

## Restrictions
<!-- One restriction per line as a bullet. Leave empty if there are no hard no-go constraints. -->
`
