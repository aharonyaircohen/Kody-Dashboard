/**
 * @fileType util
 * @domain executables
 * @pattern executables-index
 * @ai-summary Public surface for the executables feature — re-exports the
 *   file layer (folder CRUD under `.kody/executables/<slug>/`) and the pure
 *   profile helpers (form fields <-> profile.json, validation).
 */

export * from "./profile";
export * from "./files";
