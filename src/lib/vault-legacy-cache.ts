import { deleteDatabase } from "./vault-storage";

// Global, un-namespaced cache slots used before caches were scoped per user.
const LEGACY_VAULT_KEY = "locker:vault-key:v1";
const LEGACY_VAULT_ITEMS_KEY = "locker:vault-items:v2";
const LEGACY_DATABASE_NAME = "locker-documents";

/**
 * Deletes the pre-namespacing global cache. It may belong to another account, and the
 * server copy is authoritative, so nothing is migrated. Only unsynced offline edits made
 * before the upgrade are lost.
 */
export async function purgeLegacyCache(): Promise<void> {
  localStorage.removeItem(LEGACY_VAULT_KEY);
  localStorage.removeItem(LEGACY_VAULT_ITEMS_KEY);
  await deleteDatabase(LEGACY_DATABASE_NAME);
}
