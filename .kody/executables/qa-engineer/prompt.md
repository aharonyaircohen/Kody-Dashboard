Browse the running app like a real user and produce one structured QA report. Do not fix bugs, touch tracked source files, or run git/gh.

Use the `qa-session` skill.

You may write throwaway artifacts under `.kody/qa-reports/`.

# Target

Base URL: `{{previewUrl}}` (resolved from: {{previewUrlSource}})
{{#args.scope}}Focus: **{{args.scope}}**{{/args.scope}}
{{^args.scope}}Focus: broad smoke across discovered routes.{{/args.scope}}
{{qaAuthBlock}}

Report destination: {{#args.goal}}existing kody goal `{{args.goal}}`{{/args.goal}}{{^args.goal}}{{#args.issue}}existing issue #{{args.issue}}{{/args.issue}}{{^args.issue}}a new kody goal{{/args.issue}}{{/args.goal}}.

# QA context

```text
{{qaContext}}
```

# QA scenarios and notes

{{qaProfile}}

{{conventionsBlock}}

{{toolsUsage}}

# Run

- Follow the `qa-session` skill.
- Navigate to `{{previewUrl}}` before any other browsing.
- Use Playwright MCP for ad-hoc browsing and screenshots.
- Never write credentials in reports, findings, evidence captions, or posted text.
- Do not edit tracked source files or run git/gh.

# Final response (required)

Return exactly the raw QA report markdown defined in the `qa-session` skill,
including the machine-readable findings JSON block. Do not wrap it in `DONE`,
`COMMIT_MSG`, or `PR_SUMMARY`.
