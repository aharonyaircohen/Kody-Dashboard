/**
 * @fileType utility
 * @domain kody
 * @pattern repo-files-icons
 * @ai-summary Maps file extensions to lucide-react icons for the file tree.
 */
import {
  type LucideIcon,
  File,
  FileText,
  FileCode2,
  FileJson,
  Folder,
  Image,
  FileArchive,
  Link2,
  FileCheck,
  FileX,
  FileWarning,
  Binary,
  Shell,
} from "lucide-react";

export const FILE_ICON_MAP: Record<string, LucideIcon> = {
  // Directories
  directory: Folder,
  folder: Folder,

  // Code
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

  // Data
  json: FileJson,
  jsonc: FileJson,
  json5: FileJson,
  toml: FileJson,
  yaml: FileJson,
  yml: FileJson,

  // Markdown / Docs
  md: FileText,
  mdx: FileText,
  markdown: FileText,
  txt: FileText,
  rst: FileText,

  // Config (treat as code)
  xml: FileCode2,
  svg: Image,
  xsl: FileCode2,
  xslt: FileCode2,

  // Shell
  sh: Shell,
  bash: Shell,
  zsh: Shell,
  fish: Shell,
  ps1: Shell,
  bat: Shell,
  cmd: Shell,

  // Images
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  webp: Image,
  ico: Image,

  // Archives
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
  bz2: FileArchive,

  // Binary
  exe: Binary,
  dll: Binary,
  so: Binary,
  dylib: Binary,
  wasm: Binary,
  bin: Binary,

  // Docs
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  xls: FileText,
  xlsx: FileText,
  ppt: FileText,
  pptx: FileText,

  // Special
  gitignore: FileCheck,
  gitattributes: FileCheck,
  editorconfig: FileCheck,
  prettierrc: FileCheck,
  eslintrc: FileCheck,
  env: FileWarning,
  "env.local": FileWarning,
  "env.development": FileWarning,
  "env.production": FileWarning,
  lock: FileCheck,
  "package-lock.json": FileCheck,
  "pnpm-lock.yaml": FileCheck,
  "yarn.lock": FileCheck,
  "Cargo.lock": FileCheck,
  "go.mod": FileCheck,
  "go.sum": FileCheck,
  Gemfile: FileCheck,
  "Gemfile.lock": FileCheck,
  "requirements.txt": FileCheck,
  "pyproject.toml": FileCheck,
  "poetry.lock": FileCheck,
};

export type FileType = "file" | "dir" | "symlink";

export function getFileIcon(name: string, type: FileType): LucideIcon {
  if (type === "dir") {
    return Folder;
  }
  if (type === "symlink") {
    return Link2;
  }

  const lower = name.toLowerCase();

  // Check for dotfiles
  if (lower.startsWith(".")) {
    const base = lower.slice(1);
    if (FILE_ICON_MAP[base]) return FILE_ICON_MAP[base];
    if (base in FILE_ICON_MAP) return FILE_ICON_MAP[base];
  }

  // Check extension
  const parts = lower.split(".");
  if (parts.length >= 2) {
    const ext = parts[parts.length - 1];
    // Handle .d.ts, .d.mts, etc.
    if (ext === "d") {
      const baseExt = parts[parts.length - 2];
      return FILE_ICON_MAP[`d.ts`] ?? FILE_ICON_MAP[baseExt] ?? FileCode2;
    }
    if (FILE_ICON_MAP[ext]) return FILE_ICON_MAP[ext];
  }

  // Check for special filenames
  if (lower in FILE_ICON_MAP) return FILE_ICON_MAP[lower];

  // Default
  return File;
}

export function getFileTypeIcon(name: string, mimeType?: string): LucideIcon {
  if (mimeType) {
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType.startsWith("text/")) return FileText;
    if (mimeType.includes("json")) return FileJson;
    if (mimeType.includes("zip") || mimeType.includes("archive"))
      return FileArchive;
    if (mimeType.includes("binary") || mimeType.includes("octet"))
      return Binary;
  }
  return getFileIcon(name, "file");
}
