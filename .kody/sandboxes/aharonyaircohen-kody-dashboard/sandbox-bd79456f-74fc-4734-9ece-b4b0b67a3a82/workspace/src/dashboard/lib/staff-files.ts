/**
 * @fileType util
 * @domain kody
 * @pattern staff-files
 * @ai-summary Staff preset over the shared ticked-file store. A staff
 *   member is a `.kody/staff/<slug>.md` file; duties and staff are the
 *   same mechanism, so the implementation lives once in `ticked/files.ts`.
 *   This file binds the staff directory / commit scope / cache and
 *   re-exports the API under the `*StaffFile` names so importers stay
 *   stable.
 */

import { invalidateStaffCache } from "./github-client";
import { createTickedFiles, type TickFile } from "./ticked/files";

/** Alias — duties and staff share the `TickFile` shape. */
export type StaffFile = TickFile;

const impl = createTickedFiles({
  dir: ".kody/staff",
  commitScope: "staff",
  invalidateCache: invalidateStaffCache,
});

export const listStaffFiles = impl.listFiles;
export const readStaffFile = impl.readFile;
export const writeStaffFile = impl.writeFile;
export const deleteStaffFile = impl.deleteFile;
export const isValidSlug = impl.isValidSlug;
