export const CONTENT_ENTRIES_PATH = "/content/entries";
export const CONTENT_MODELS_PATH = "/content/models";
export const CONTENT_SETTINGS_PATH = "/content/settings";

export function cmsCollectionPath(collection: string): string {
  return `${CONTENT_ENTRIES_PATH}/${encodeURIComponent(collection)}`;
}

export function cmsCreatePath(collection: string): string {
  return `${CONTENT_ENTRIES_PATH}/new/${encodeURIComponent(collection)}`;
}

export function cmsDocumentPath(collection: string, id: string): string {
  return `${cmsCollectionPath(collection)}/${encodeURIComponent(id)}`;
}

export function cmsDocumentEditPath(collection: string, id: string): string {
  return `${cmsDocumentPath(collection, id)}/edit`;
}
