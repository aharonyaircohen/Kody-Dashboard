import type {
  CmsCollectionConfig,
  CmsContentOperation,
  CmsPermissionsConfig,
  CmsRole,
} from "../../cms/types";

export type CmsWriteOperation = "create" | "update" | "delete";

const DEFAULT_CONTENT_PERMISSIONS: Record<CmsContentOperation, CmsRole[]> = {
  list: ["viewer", "editor", "admin"],
  get: ["viewer", "editor", "admin"],
  search: ["viewer", "editor", "admin"],
  create: ["editor", "admin"],
  update: ["editor", "admin"],
  delete: ["admin"],
};

export function canWriteOperation(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
  actorRole: CmsRole = "admin",
  permissions?: CmsPermissionsConfig,
): boolean {
  if (
    !collection.operations[operation] ||
    collection.writePolicy !== "enabled"
  ) {
    return false;
  }
  return rolesForWriteOperation(collection, operation, permissions).includes(
    actorRole,
  );
}

export function writeDisabledReason(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
  actorRole: CmsRole = "admin",
  permissions?: CmsPermissionsConfig,
): string {
  if (!collection.operations[operation]) return "Operation disabled";
  if (collection.writePolicy === "approval-required")
    return "Approval required";
  if (collection.writePolicy === "read-only") return "Read-only";
  if (
    !rolesForWriteOperation(collection, operation, permissions).includes(
      actorRole,
    )
  ) {
    return `${roleLabel(actorRole)} role cannot ${operation}`;
  }
  return "Operation disabled";
}

function rolesForWriteOperation(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
  permissions?: CmsPermissionsConfig,
): CmsRole[] {
  return (
    collection.permissions?.content?.[operation] ??
    permissions?.content?.[operation] ??
    DEFAULT_CONTENT_PERMISSIONS[operation]
  );
}

function roleLabel(role: CmsRole): string {
  if (role === "admin") return "Admin";
  if (role === "editor") return "Editor";
  return "Viewer";
}
