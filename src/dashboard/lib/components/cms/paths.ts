export function cmsDocumentPath(collection: string, id: string): string {
  return `/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
}

export function cmsDocumentEditPath(collection: string, id: string): string {
  return `${cmsDocumentPath(collection, id)}/edit`;
}
