/**
 * @fileType utility
 * @domain kody
 * @pattern company-intents-read-cache
 *
 * Short-lived cache for the assembled Company Intents list read model.
 */

import type { CompanyIntentRecord } from "./company-intents";
import { createServerTtlCache } from "./server-ttl-cache";

const COMPANY_INTENTS_LIST_TTL_MS = 120_000;
const companyIntentRecordsCache = createServerTtlCache<CompanyIntentRecord[]>({
  ttlMs: COMPANY_INTENTS_LIST_TTL_MS,
});

function companyIntentRecordsKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export async function getCachedCompanyIntentRecords(
  owner: string,
  repo: string,
  load: () => Promise<CompanyIntentRecord[]>,
): Promise<CompanyIntentRecord[]> {
  return companyIntentRecordsCache.get(
    companyIntentRecordsKey(owner, repo),
    load,
  );
}

export function clearCompanyIntentRecordsCache(owner: string, repo: string) {
  companyIntentRecordsCache.delete(companyIntentRecordsKey(owner, repo));
}
