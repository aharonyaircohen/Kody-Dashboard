import { mongoCmsAdapter } from "./mongodb";
import type { CmsAdapter } from "./types";

const ADAPTERS = new Map<string, CmsAdapter>([
  [mongoCmsAdapter.name, mongoCmsAdapter],
]);

export function getCmsAdapter(name: string): CmsAdapter | null {
  return ADAPTERS.get(name) ?? null;
}

export type { CmsAdapter, CmsAdapterContext } from "./types";
export { CmsAdapterError } from "./types";
