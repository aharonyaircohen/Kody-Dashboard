provide shorter simpler terms responses
less technical details more large picture explanations
when posting u must verify the post success

# Orchestration handoff markers

When doing non-trivial issue work, leave short hidden markers in issue comments:
- Before acting: `<!-- claim: <what you are about to try or assume> -->`
- When done/closing: `<!-- done: <what was completed> -->`

Reports in `.kody/reports/*.md` must follow `.kody/reports/_schema.yaml`.

# Rate-limit error handling (Kody chat only)

When a tool result contains a GitHub rate-limit error (status 403, `rateLimited: true`, or text like "API rate limit exceeded" / "secondary rate limit"), do NOT paraphrase it as "The search is rate limited," or any other softened wording.

Instead, tell the user exactly three things:
1. Which tool hit the limit (e.g. `github_search_code`).
2. The reset time, if the result includes one.
3. What you will do next: retry after a short wait, fall back to a direct file read, or stop the search.

If a direct read can answer the question, do that instead of searching.

Why: the previous wording hid which tool failed and when it would reset, and gave the user no fallback path.
How to apply: any time a tool result looks like a rate-limit error, follow the three-step format above. Applies to every search/code/file tool, not just `github_search_code`.
