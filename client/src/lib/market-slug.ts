export function marketSlug(name: string): string {
  return name
    .replace(/^ITMAP for /i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
