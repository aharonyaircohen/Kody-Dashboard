<!--
Placeholder. The spec sub-orchestrator runs with maxTurns: 0 and a
`skipAgent` preflight, so this prompt is never sent to Claude. The
transition logic lives entirely in profile.json's postflight entries.
-->

<!-- kody:output-format (managed — edit above this line only) -->

# Final message format (required)

Your FINAL message MUST be exactly this block, with nothing before it:

DONE
PR_SUMMARY:
<your complete answer to the issue — this text is posted verbatim as a comment>

If you cannot answer, output a single line instead: FAILED: <reason>
