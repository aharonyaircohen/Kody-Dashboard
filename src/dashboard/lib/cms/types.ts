export type CmsFieldType =
  | "id"
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "multiSelect"
  | "relation"
  | "relationMany"
  | "json"
  | "object"
  | "array";

export type CmsFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "in"
  | "exists"
  | "greater_than"
  | "greater_than_equal"
  | "less_than"
  | "less_than_equal";

export type CmsWritePolicy = "read-only" | "approval-required" | "enabled";

export type CmsRole = "viewer" | "editor" | "admin";

export type CmsContentOperation =
  | "list"
  | "get"
  | "search"
  | "create"
  | "update"
  | "delete";

export type CmsSchemaOperation = "generate" | "refresh" | "edit";

export type CmsRoleList = CmsRole[];

export interface CmsContentPermissions {
  list?: CmsRoleList;
  get?: CmsRoleList;
  search?: CmsRoleList;
  create?: CmsRoleList;
  update?: CmsRoleList;
  delete?: CmsRoleList;
}

export interface CmsSchemaPermissions {
  generate?: CmsRoleList;
  refresh?: CmsRoleList;
  edit?: CmsRoleList;
}

export interface CmsPermissionsConfig {
  content?: CmsContentPermissions;
  schema?: CmsSchemaPermissions;
}

export interface CmsFieldOption {
  label: string;
  value: string;
}

export type CmsFieldStorageKind =
  | "string"
  | "stringArray"
  | "number"
  | "boolean"
  | "date"
  | "dateString"
  | "objectId"
  | "objectIdArray"
  | "json"
  | "object"
  | "array";

export interface CmsFieldStorageConfig {
  kind: CmsFieldStorageKind;
}

export interface CmsFieldConfig {
  name: string;
  type: CmsFieldType;
  label?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  options?: Array<string | CmsFieldOption>;
  target?: string;
  valueField?: string;
  labelField?: string;
  storage?: CmsFieldStorageConfig;
}

export interface CmsFilterConfig {
  field: string;
  operators?: CmsFilterOperator[];
}

export interface CmsCollectionSource {
  collection?: string;
  idField?: string;
  path?: string;
  extension?: string;
}

export interface CmsSortEntry {
  field: string;
  direction?: "asc" | "desc";
}

export type CmsViewFieldRole = "primary" | "secondary" | "meta";
export type CmsViewFieldDisplay = "value" | "label" | "count" | "json";
export type CmsViewFieldFormat =
  | "text"
  | "date"
  | "datetime"
  | "number"
  | "boolean"
  | "json";
export type CmsViewFieldWidth = "xs" | "sm" | "md" | "lg" | "fill";

export interface CmsViewFieldConfig {
  name: string;
  label?: string;
  role?: CmsViewFieldRole;
  display?: CmsViewFieldDisplay;
  format?: CmsViewFieldFormat;
  width?: CmsViewFieldWidth;
  sortable?: boolean;
}

export interface CmsListViewConfig {
  fields: CmsViewFieldConfig[];
  pageSize?: number;
}

export interface CmsDetailViewConfig {
  fields: CmsViewFieldConfig[];
}

export interface CmsFormViewConfig {
  fields: CmsViewFieldConfig[];
}

export interface CmsCollectionViewsConfig {
  list?: CmsListViewConfig;
  detail?: CmsDetailViewConfig;
  form?: CmsFormViewConfig;
}

export interface CmsCollectionOperations {
  list: boolean;
  get: boolean;
  search: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

export interface CmsCollectionConfig {
  name: string;
  label: string;
  adapter: string;
  mcpName?: string;
  titleField?: string;
  searchFields: string[];
  views?: CmsCollectionViewsConfig;
  /** @deprecated Use views.list.fields. Kept for existing CMS state files. */
  listFields?: string[];
  writePolicy: CmsWritePolicy;
  permissions?: CmsPermissionsConfig;
  source: CmsCollectionSource;
  operations: CmsCollectionOperations;
  defaultSort: CmsSortEntry[];
  fields: CmsFieldConfig[];
  filters: CmsFilterConfig[];
}

export type CmsAdapterSettings = Record<string, unknown>;

export interface CmsRuntimeConfig {
  version: 1;
  name: string;
  environment: string;
  defaultAdapter?: string;
  writePolicy: CmsWritePolicy;
  permissions: CmsPermissionsConfig;
  adapters: Record<string, CmsAdapterSettings>;
  collections: Record<string, CmsCollectionConfig>;
}

export interface CmsPublicConfig {
  configured: true;
  version: 1;
  name: string;
  environment: string;
  defaultAdapter?: string;
  writePolicy: CmsWritePolicy;
  actorRole?: CmsRole;
  permissions: CmsPermissionsConfig;
  collections: CmsCollectionConfig[];
}

export interface CmsUnconfiguredConfig {
  configured: false;
  collections: [];
}

export type CmsConfigState = CmsPublicConfig | CmsUnconfiguredConfig;

export type CmsDocument = Record<string, unknown>;

export interface CmsSearchQuery {
  query: string;
  fields?: string[];
}

export interface CmsListQuery {
  filters?: Record<string, Partial<Record<CmsFilterOperator, unknown>>>;
  search?: CmsSearchQuery;
  sort?: CmsSortEntry[];
  limit?: number;
  offset?: number;
  ids?: string[];
}

export interface CmsListResult {
  docs: CmsDocument[];
  total: number;
  limit: number;
  offset: number;
}
