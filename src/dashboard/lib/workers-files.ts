/**
 * @fileType util
 * @domain kody
 * @pattern workers-files
 * @ai-summary Worker preset over the shared ticked-file store. A worker
 *   is a `.kody/workers/<slug>.md` file; jobs and workers are the same
 *   mechanism, so the implementation lives once in `ticked/files.ts`.
 *   This file binds the workers directory / commit scope / cache and
 *   re-exports the API under the legacy `*WorkerFile` names so existing
 *   importers don't change.
 */

import { invalidateWorkersCache } from "./github-client";
import { createTickedFiles, type TickFile } from "./ticked/files";

/** Legacy alias — jobs and workers share the `TickFile` shape. */
export type WorkerFile = TickFile;

const impl = createTickedFiles({
  dir: ".kody/workers",
  commitScope: "workers",
  invalidateCache: invalidateWorkersCache,
});

export const listWorkerFiles = impl.listFiles;
export const readWorkerFile = impl.readFile;
export const writeWorkerFile = impl.writeFile;
export const deleteWorkerFile = impl.deleteFile;
export const isValidSlug = impl.isValidSlug;
