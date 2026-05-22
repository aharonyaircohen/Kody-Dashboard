/**
 * @fileType util
 * @domain kody
 * @pattern jobs-files
 * @ai-summary Job preset over the shared ticked-file store. A job is a
 *   `.kody/jobs/<slug>.md` file; jobs and workers are the same
 *   mechanism, so the implementation lives once in `ticked/files.ts`.
 *   This file binds the jobs directory / commit scope / cache and
 *   re-exports the API under the legacy `*JobFile` names so existing
 *   importers don't change.
 */

import { invalidateJobsCache } from "./github-client";
import { createTickedFiles, type TickFile } from "./ticked/files";

/** Legacy alias — jobs and workers share the `TickFile` shape. */
export type JobFile = TickFile;

const impl = createTickedFiles({
  dir: ".kody/jobs",
  commitScope: "jobs",
  invalidateCache: invalidateJobsCache,
});

export const listJobFiles = impl.listFiles;
export const readJobFile = impl.readFile;
export const writeJobFile = impl.writeFile;
export const deleteJobFile = impl.deleteFile;
export const isValidSlug = impl.isValidSlug;
