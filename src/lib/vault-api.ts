import type {
  EncryptedVaultItem,
  VaultMetadata,
  VaultRecord,
  VaultStorageVersion,
} from "@/types/vault";

export async function getCloudVaultMetadata(): Promise<VaultMetadata | null> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load the cloud vault.");
  }
  const body = await response.json() as { metadata: VaultMetadata | null };
  return body.metadata;
}

export async function storeCloudVaultRecord(
  record: VaultRecord,
  storageVersion: VaultStorageVersion,
): Promise<void> {
  const response = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record, storageVersion }),
  });
  if (!response.ok) {
    throw new Error("Could not sync the encrypted vault envelope.");
  }
}

export async function getCloudEncryptedItems(): Promise<EncryptedVaultItem[]> {
  const response = await fetch("/api/vault/items", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load encrypted vault items.");
  }
  const body = await response.json() as { items: EncryptedVaultItem[] };
  return body.items;
}

export async function storeCloudEncryptedItem(item: EncryptedVaultItem): Promise<void> {
  const response = await fetch(`/api/vault/items/${encodeURIComponent(item.itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    throw new Error("Could not sync the encrypted vault item.");
  }
}

export async function deleteCloudEncryptedItem(itemId: string): Promise<void> {
  const response = await fetch(`/api/vault/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Could not delete the encrypted vault item.");
  }
}

export async function completeCloudMigration(expectedItemIds: string[]): Promise<string> {
  const response = await fetch("/api/vault/migration", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedItemIds }),
  });
  if (!response.ok) {
    throw new Error("Could not activate per-item vault storage.");
  }
  const body = await response.json() as { migratedAt: string };
  return body.migratedAt;
}
