// Empty stub. Aliased in for Node-only builtins (e.g. `fs`) that get pulled
// into the browser bundle by libraries which guard the call at runtime
// (e.g. @mintplex-labs/piper-tts-web: `if (ENVIRONMENT_IS_NODE) require("fs")`).
// Next's webpack auto-stubs these for the client; Turbopack does not, so we
// point them here. See next.config.mjs `turbopack.resolveAlias`.
export default {};
