/**
 * @fileType utility
 * @domain files
 * @pattern repo-files-lang
 * @ai-summary Maps file extensions to Monaco Editor language identifiers
 *   for syntax highlighting in the file viewer and editor.
 */

/**
 * Monaco Editor language ID mapping keyed by file extension.
 * Covers all languages Monaco supports out of the box.
 */
export const EXT_TO_LANG: Record<string, string> = {
  // JavaScript / TypeScript
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",

  // Web
  html: "html",
  htm: "html",
  shtml: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",

  // Config / Data
  json: "json",
  jsonc: "json",
  json5: "json",
  toml: "ini",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",

  // Shell / scripting
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psh: "powershell",
  bat: "bat",
  cmd: "bat",

  // Documentation
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  txt: "plaintext",

  // Python
  py: "python",
  pyw: "python",
  pyi: "python",

  // Go
  go: "go",

  // Rust
  rs: "rust",

  // Ruby
  rb: "ruby",
  erb: "ruby",

  // PHP
  php: "php",

  // Java / JVM
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  groovy: "groovy",

  // C / C++
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",

  // C#
  cs: "csharp",

  // Swift
  swift: "swift",

  // AgentGoal-C
  m: "agentGoal-c",
  mm: "agentGoal-c",

  // SQL
  sql: "sql",

  // R
  r: "r",
  R: "r",

  // Shell
  ash: "shell",
  dash: "shell",

  // Docker
  dockerfile: "dockerfile",

  // GraphQL
  graphql: "graphql",
  gql: "graphql",

  // Vue
  vue: "html",

  // Svelte
  svelte: "html",

  // Lua
  lua: "lua",

  // Perl
  pl: "perl",
  pm: "perl",

  // Haskell
  hs: "haskell",

  // Elixir
  ex: "elixir",
  exs: "elixir",
  leex: "html",
  heex: "html",

  // Erlang
  erl: "erlang",
  hrl: "erlang",

  // Clojure
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",

  // Scala
  sc: "scala",

  // F#
  fs: "fsharp",
  fsi: "fsharp",
  fsx: "fsharp",

  // Dart
  dart: "dart",

  // Zig
  zig: "zig",

  // Nim
  nim: "nim",

  // Crystal
  cr: "crystal",

  // V
  v: "v",
  vv: "v",

  // OCaml
  ml: "ocaml",
  mli: "ocaml",

  // Markdown
  mdown: "markdown",
  markdn: "markdown",

  // Jupyter
  ipynb: "json",

  // SVG
  svg: "xml",

  // TOML (Monaco doesn't have TOML, use ini as fallback)
  // Already mapped above

  // INI
  // Already mapped above
};

/**
 * Detect the Monaco language ID from a filename or path.
 * Returns null if the language cannot be determined.
 */
export function detectLanguage(filename: string): string | null {
  const name = filename.toLowerCase();

  // Special filenames
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  if (name === ".gitignore" || name === ".gitattributes") return "plaintext";
  if (name === ".env" || name.startsWith(".env.")) return "shell";

  const parts = name.split(".");
  if (parts.length < 2) return null;

  const ext = parts.pop()!;
  return EXT_TO_LANG[ext] ?? null;
}

/**
 * Monaco language ID for a path, or "plaintext" as fallback.
 */
export function monacoLanguage(path: string): string {
  return detectLanguage(path) ?? "plaintext";
}
