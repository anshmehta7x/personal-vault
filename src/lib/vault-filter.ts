import type { VaultFilter, VaultItem } from "@/types/vault";

function matchesQuery(item: VaultItem, normalizedQuery: string): boolean {
  const searchText = [
    item.title,
    item.notes,
    ...item.fields.flatMap((field) => [field.label, field.value]),
    ...item.documents.map((document) => document.name),
  ].join(" ").toLowerCase();
  return searchText.includes(normalizedQuery);
}

/** Returns the items shown for a sidebar filter and search query, newest first. */
export function filterVaultItems(
  items: VaultItem[],
  filter: VaultFilter,
  query: string,
): VaultItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items
    .filter((item) => filter === "trash" ? Boolean(item.deletedAt) : !item.deletedAt)
    .filter((item) => filter === "all" || filter === "trash" || item.category === filter)
    .filter((item) => !normalizedQuery || matchesQuery(item, normalizedQuery))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
