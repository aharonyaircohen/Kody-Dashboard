/**
 * @fileType utility
 * @domain kody
 * @pattern repo-files-lang
 * @ai-summary Maps file extensions to Monaco Editor language IDs.
 */

export const EXT_TO_LANG: Record<string, string> = {
  // JavaScript / TypeScript
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  dts: "typescript",

  // Web
  html: "html",
  htm: "html",
  shtml: "html",
  xhtml: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",

  // Data
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  toml: "ini",
  yaml: "yaml",
  yml: "yaml",

  // Markdown
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",

  // Python
  py: "python",
  pyw: "python",
  pyi: "python",
  pyx: "python",
  pxd: "python",

  // Ruby
  rb: "ruby",
  rbw: "ruby",
  rake: "ruby",
  gemspec: "ruby",

  // Go
  go: "go",

  // Rust
  rs: "rust",

  // Java / Kotlin
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",

  // C / C++
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  "h++": "cpp",

  // C#
  cs: "csharp",

  // PHP
  php: "php",
  phtml: "php",

  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ksh: "shell",
  ash: "shell",

  // PowerShell
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",

  // SQL
  sql: "sql",
  mysql: "sql",
  postgres: "sql",
  sqlite: "sql",

  // Docker / Infra
  dockerfile: "dockerfile",
  dockerignore: "dockerfile",
  tfvars: "hcl",
  tf: "hcl",
  hcl: "hcl",
  terraform: "hcl",

  // Config
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "ini",

  // XML
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  svg: "xml",
  xul: "xml",
  rss: "xml",
  atom: "xml",

  // Web assembly
  wasm: "wast",

  // GraphQL
  graphql: "graphql",
  gql: "graphql",

  // Markdown
  rst: "rst",

  // LaTeX
  tex: "latex",

  // Lua
  lua: "lua",

  // Perl
  pl: "perl",
  pm: "perl",
  perl: "perl",

  // R
  r: "r",
  R: "r",
  Rprofile: "r",

  // Julia
  jl: "julia",

  // Crystal
  cr: "crystal",

  // Elixir / Erlang
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",

  // Clojure
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",

  // Haskell
  hs: "haskell",

  // OCaml
  ml: "ocaml",
  mli: "ocaml",

  // F#
  fs: "fsharp",
  fsx: "fsharp",
  fsproj: "xml",

  // Elm
  elm: "elm",

  // Dart
  dart: "dart",

  // Swift
  swift: "swift",

  // Objective-C
  m: "objective-c",
  mm: "objective-c",

  // Vim
  vim: "lua",

  // Plain text fallback
  txt: "plaintext",
  text: "plaintext",
  log: "plaintext",
  diff: "plaintext",
  patch: "plaintext",

  // CSV / TSV
  csv: "r",
  tsv: "r",

  // Makefile
  makefile: "makefile",
  mk: "makefile",

  // Nginx
  nginx: "ini",

  // Apache
  htaccess: "ini",

  // Git
  gitignore: "ignore",
  gitattributes: "ignore",

  // Editor configs
  editorconfig: "ini",

  // Dotenv
  env: "shellsession",
  "env.local": "shellsession",
  "env.development": "shellsession",
  "env.production": "shellsession",
  "env.test": "shellsession",

  // Build files
  gradle: "java",
  gradle_kts: "kotlin",
  maven: "xml",
  ant: "xml",
  bazel: "python",
  buck: "python",

  // Package files
  "package.json": "json",
  "package-lock.json": "json",
  "tsconfig.json": "json",
  "jsconfig.json": "json",
  "deno.json": "json",
  "deno.jsonc": "json",
  ".prettierrc": "json",
  ".eslintrc": "json",
  "eslint.config.js": "javascript",
  "vite.config.ts": "typescript",
  "vite.config.js": "javascript",
  "next.config.js": "javascript",
  "next.config.mjs": "javascript",

  // Lock files
  "pnpm-lock.yaml": "yaml",
  "yarn.lock": "ini",
  "Cargo.lock": "toml",
  "go.sum": "plaintext",
  "go.mod": "go",

  // Solidity
  sol: "sol",

  // Cairo
  cairo: "cairo",

  // Move
  move: "move",
};

/**
 * Detect the Monaco language ID from a filename.
 * Returns "plaintext" as the fallback for unknown extensions.
 */
export function detectLanguage(filename: string): string {
  if (!filename) return "plaintext";
  const lower = filename.toLowerCase();

  // Handle filenames starting with dot (dotfiles)
  if (lower.startsWith(".")) {
    const base = lower.slice(1);
    if (base in EXT_TO_LANG) return EXT_TO_LANG[base];
    // Special dotfiles
    if (base === "dockerignore") return "dockerfile";
    if (base === "gitignore") return "ignore";
    if (base === "gitattributes") return "ignore";
    if (base === "editorconfig") return "ini";
    if (
      base === "env" ||
      base === "env.local" ||
      base === "env.production" ||
      base === "env.development"
    ) {
      return "shellsession";
    }
    if (
      base === "prettierrc" ||
      base === "prettierrc.json" ||
      base === ".prettierrc.yaml" ||
      base === ".prettierrc.yml"
    ) {
      return "json";
    }
    if (
      base === "eslintrc" ||
      base === "eslintrc.json" ||
      base === ".eslintrc.js"
    ) {
      return "json";
    }
    if (base.startsWith("prettierrc.")) {
      const ext = base.slice("prettierrc.".length);
      if (ext in EXT_TO_LANG) return EXT_TO_LANG[ext];
    }
    if (base.startsWith("eslintrc.")) {
      const ext = base.slice("eslintrc.".length);
      if (ext in EXT_TO_LANG) return EXT_TO_LANG[ext];
    }
    return "plaintext";
  }

  // Handle "Dockerfile" and "Dockerfile.prod" etc.
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
    return "dockerfile";
  }

  // Handle Makefile
  if (lower === "makefile" || lower === "makefile.include") {
    return "makefile";
  }

  // Get extension
  const parts = lower.split(".");
  if (parts.length < 2) {
    // No extension - check full name
    if (lower in EXT_TO_LANG) return EXT_TO_LANG[lower];
    return "plaintext";
  }

  const ext = parts[parts.length - 1];

  // Special handling for certain extensions
  if (ext === "d") {
    // TypeScript definition files
    if (parts.length >= 2) {
      const prev = parts[parts.length - 2];
      if (prev === "d" || prev === "d.mts" || prev === "d.cts")
        return "typescript";
    }
  }

  return EXT_TO_LANG[ext] ?? "plaintext";
}

/**
 * Check if a file is likely a binary file based on extension.
 */
export function isBinaryFile(filename: string): boolean {
  const binaryExts = [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "ico",
    "bmp",
    "tiff",
    "tif",
    "svg",
    "exe",
    "dll",
    "so",
    "dylib",
    "dll",
    "a",
    "o",
    "obj",
    "lib",
    "zip",
    "tar",
    "gz",
    "rar",
    "7z",
    "bz2",
    "xz",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "woff",
    "woff2",
    "ttf",
    "eot",
    "otf",
    "woff",
    "mp3",
    "mp4",
    "wav",
    "ogg",
    "webm",
    "avi",
    "mov",
    "flac",
    "wasm",
    "wat",
    "db",
    "sqlite",
    "sqlite3",
    "mdb",
    "pyc",
    "pyo",
    "class",
    "jar",
    "tgz",
    "tbz",
    "txz",
  ];
  const lower = filename.toLowerCase();
  const parts = lower.split(".");
  if (parts.length < 2) return false;
  const ext = parts[parts.length - 1];
  return binaryExts.includes(ext);
}

/**
 * Format file size in human-readable format.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format a date string for display.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
