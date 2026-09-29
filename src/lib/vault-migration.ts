import {
  decryptVaultItem,
  encryptVaultItem,
} from "@/lib/vault-crypto";
import {
  completeCloudMigration,
  getCloudEncryptedItems,
  storeCloudEncryptedItem,
} from "@/lib/vault-api";
import { storeLocalEncryptedItems } from "@/lib/vault-storage";
import type { EncryptedVaultItem, VaultData, VaultItem } from "@/types/vault";

function verifyMigratedItems(expected: VaultItem[], actual: VaultItem[]): void {
  const expectedItems = new Map(expected.map((item) => [item.id, item]));
  const actualItems = new Map(actual.map((item) => [item.id, item]));
  const hasDuplicates = expectedItems.size !== expected.length || actualItems.size !== actual.length;
  const isMismatch = hasDuplicates
    || expectedItems.size !== actualItems.size
    || [...expectedItems].some(([id, item]) => (
      JSON.stringify(item) !== JSON.stringify(actualItems.get(id))
    ));
  if (isMismatch) {
    throw new Error("Migrated vault items did not match the legacy vault.");
  }
}

export async function migrateLegacyVault(
  data: VaultData,
  key: CryptoKey,
): Promise<{ encryptedItems: EncryptedVaultItem[]; migratedAt: string }> {
  const encryptedItems = await Promise.all(
    data.items.map((item) => encryptVaultItem(key, item)),
  );
  await Promise.all(encryptedItems.map(storeCloudEncryptedItem));

  const uploadedItems = await getCloudEncryptedItems();
  const decryptedItems = await Promise.all(
    uploadedItems.map((item) => decryptVaultItem(key, item)),
  );
  verifyMigratedItems(data.items, decryptedItems);

  const migratedAt = await completeCloudMigration(data.items.map((item) => item.id));
  storeLocalEncryptedItems(uploadedItems);
  return { encryptedItems: uploadedItems, migratedAt };
}
