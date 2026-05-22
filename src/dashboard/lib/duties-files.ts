/**
 * @fileType util
 * @domain kody
 * @pattern duties-files
 * @ai-summary Duty preset over the shared ticked-file store. A duty is a
 *   `.kody/duties/<slug>.md` file; duties and staff are the same
 *   mechanism, so the implementation lives once in `ticked/files.ts`.
 *   This file binds the duties directory / commit scope / cache and
 *   re-exports the API under the `*DutyFile` names so importers stay
 *   stable.
 */

import { invalidateDutiesCache } from "./github-client";
import { createTickedFiles, type TickFile } from "./ticked/files";

/** Alias — duties and staff share the `TickFile` shape. */
export type DutyFile = TickFile;

const impl = createTickedFiles({
  dir: ".kody/duties",
  commitScope: "duties",
  invalidateCache: invalidateDutiesCache,
});

export const listDutyFiles = impl.listFiles;
export const readDutyFile = impl.readFile;
export const writeDutyFile = impl.writeFile;
export const deleteDutyFile = impl.deleteFile;
export const isValidSlug = impl.isValidSlug;
