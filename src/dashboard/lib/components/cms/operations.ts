import type { CmsCollectionConfig } from "../../cms/types";

export type CmsWriteOperation = "create" | "update" | "delete";

export function canWriteOperation(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
): boolean {
  return collection.operations[operation] && collection.writePolicy === "enabled";
}

export function writeDisabledReason(collection: CmsCollectionConfig): string {
  if (collection.writePolicy === "approval-required") return "Approval required";
  if (collection.writePolicy === "read-only") return "Read-only";
  return "Operation disabled";
}
