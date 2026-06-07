/**
 * @fileType utility
 * @domain files
 * @pattern repo-files-icons
 * @ai-summary Maps file extensions and special filenames to lucide-react
 *   icons for the file tree and other file-related UI elements.
 */
"use client";

import {
  Folder,
  FolderOpen,
  File,
  FileCode2,
  FileText,
  Image,
  FileJson,
  FileTerminal,
  FileBadge,
  Link2,
  type LucideIcon,
} from "lucide-react";

// Extension → icon registry
const EXT_ICON_MAP: Record<string, LucideIcon> = {
  // Source code
  ts: FileCode2,
  tsx: FileCode2,
  js: FileCode2,
  jsx: FileCode2,
  mjs: FileCode2,
  cjs: FileCode2,
  mts: FileCode2,
  cts: FileCode2,

  // Web
  html: FileCode2,
  htm: FileCode2,
  shtml: FileCode2,
  css: FileCode2,
  scss: FileCode2,
  sass: FileCode2,
  less: FileCode2,

  // Config / data
  json: FileJson,
  jsonc: FileJson,
  json5: FileJson,
  toml: FileJson,
  yaml: FileJson,
  yml: FileJson,
  xml: FileCode2,
  ini: FileJson,
  cfg: FileJson,
  conf: FileJson,

  // Shell / scripts
  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  fish: FileTerminal,
  ps1: FileTerminal,
  psh: FileTerminal,
  bat: FileTerminal,
  cmd: FileTerminal,

  // Docs
  md: FileText,
  mdx: FileText,
  markdown: FileText,
  txt: FileText,
  rst: FileText,

  // Images
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
  ico: Image,
  bmp: Image,

  // Archives
  zip: File,
  tar: File,
  gz: File,
  rar: File,
  "7z": File,

  // Certificates
  pem: FileBadge,
  crt: FileBadge,
  cer: FileBadge,
  p12: FileBadge,
  pfx: FileBadge,
};

// Special filenames → icon override
const SPECIAL_NAME_MAP: Record<string, LucideIcon> = {
  dockerfile: FileCode2,
  makefile: FileTerminal,
  procfile: FileTerminal,
  ".gitignore": FileCode2,
  ".gitattributes": FileCode2,
  ".env": FileCode2,
  ".env.local": FileCode2,
  ".env.development": FileCode2,
  ".env.production": FileCode2,
  ".eslintrc": FileCode2,
  ".eslintrc.js": FileCode2,
  ".eslintrc.json": FileCode2,
  ".prettierrc": FileCode2,
  ".prettierrc.js": FileCode2,
  ".prettierrc.json": FileCode2,
  "tsconfig.json": FileJson,
  "package.json": FileJson,
  "package-lock.json": FileJson,
  "pnpm-lock.yaml": FileJson,
  "yarn.lock": FileJson,
};

/**
 * Get the icon component for a file path.
 */
export function getFileIcon(
  path: string,
  isOpen = false,
  isSymlink = false,
  isDir = false,
): LucideIcon {
  if (isDir) return isOpen ? FolderOpen : Folder;
  if (isSymlink) return Link2;

  // Check special names first
  const name = path.split("/").pop() ?? path;
  const specialKey = name.toLowerCase();
  if (SPECIAL_NAME_MAP[specialKey]) return SPECIAL_NAME_MAP[specialKey];

  // Check extension
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (EXT_ICON_MAP[ext]) return EXT_ICON_MAP[ext];

  // Default
  return File;
}

/**
 * Get a human-readable description for a file type.
 */
export function getFileTypeLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  const labels: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript React",
    js: "JavaScript",
    jsx: "JavaScript React",
    mjs: "JavaScript Module",
    json: "JSON",
    yaml: "YAML",
    yml: "YAML",
    md: "Markdown",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    sh: "Shell Script",
    py: "Python",
    go: "Go",
    rs: "Rust",
    rb: "Ruby",
    java: "Java",
    kt: "Kotlin",
    swift: "Swift",
    c: "C",
    cpp: "C++",
    cs: "C#",
    php: "PHP",
    sql: "SQL",
    toml: "TOML",
    xml: "XML",
  };

  return labels[ext] ?? ext.toUpperCase() ?? "File";
}
