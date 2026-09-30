"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_DOCUMENT_BYTES } from "@/lib/document-limits";
import {
  createVault,
  decryptVaultItem,
  encryptVaultItem,
  rewrapVaultKey,
  unlockVaultKey,
} from "@/lib/vault-crypto";
import {
  deleteCloudEncryptedItem,
  getCloudEncryptedItems,
  getCloudVaultKeyEnvelope,
  replaceCloudVaultKeyEnvelope,
  SessionExpiredError,
  storeCloudEncryptedItem,
  storeCloudVaultKeyEnvelope,
  VaultAlreadyExistsError,
  VaultPassphraseConflictError,
} from "@/lib/vault-api";
import { purgeLegacyCache } from "@/lib/vault-legacy-cache";
import {
  clearLocalVault,
  deleteEncryptedDocument,
  deleteLocalEncryptedItem,
  getDecryptedDocument,
  getLocalEncryptedItems,
  getLocalVaultKeyEnvelope,
  hasLocalEncryptedItemCache,
  storeLocalEncryptedItems,
  storeLocalVaultKeyEnvelope,
  storeEncryptedDocument,
  upsertLocalEncryptedItem,
} from "@/lib/vault-storage";
import type {
  EncryptedVaultItem,
  VaultData,
  VaultDocument,
  VaultItem,
  VaultKeyEnvelope,
} from "@/types/vault";

type VaultStatus = "loading" | "new" | "locked" | "unlocked" | "unavailable";
type SyncStatus = "syncing" | "synced" | "offline";

const AUTO_LOCK_MS = 10 * 60 * 1000;
const MAX_HYDRATE_RETRIES = 3;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function reconcileEncryptedItems(
  localItems: EncryptedVaultItem[],
  cloudItems: EncryptedVaultItem[],
): { items: EncryptedVaultItem[]; itemsToUpload: EncryptedVaultItem[] } {
  const itemsById = new Map(cloudItems.map((item) => [item.itemId, item]));
  const itemsToUpload = localItems.filter((localItem) => {
    const cloudItem = itemsById.get(localItem.itemId);
    const isLocalNewer = !cloudItem
      || new Date(localItem.updatedAt).getTime() > new Date(cloudItem.updatedAt).getTime();
    if (isLocalNewer) {
      itemsById.set(localItem.itemId, localItem);
    }
    return isLocalNewer;
  });
  return { items: [...itemsById.values()], itemsToUpload };
}

interface ReadableItems {
  items: VaultItem[];
  encryptedItems: EncryptedVaultItem[];
}

/** Decrypts each row independently so one unreadable row cannot block the rest. */
async function decryptReadableItems(
  key: CryptoKey,
  encryptedItems: EncryptedVaultItem[],
): Promise<ReadableItems> {
  const results = await Promise.allSettled(
    encryptedItems.map((item) => decryptVaultItem(key, item)),
  );
  return results.reduce<ReadableItems>((readable, result, index) => (
    result.status === "fulfilled"
      ? {
        items: [...readable.items, result.value],
        encryptedItems: [...readable.encryptedItems, encryptedItems[index]],
      }
      : readable
  ), { items: [], encryptedItems: [] });
}

export function useVault(userId: string, onSessionExpired: () => void) {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  const [unreadableItemCount, setUnreadableItemCount] = useState(0);
  const keyRef = useRef<CryptoKey | null>(null);
  const envelopeRef = useRef<VaultKeyEnvelope | null>(null);

  useEffect(() => {
    let isCancelled = false;
    async function hydrate(): Promise<void> {
      const localEnvelope = getLocalVaultKeyEnvelope(userId);
      try {
        const cloudEnvelope = await getCloudVaultKeyEnvelope();
        if (isCancelled) {
          return;
        }
        await purgeLegacyCache();
        // The server is the source of truth for the envelope; a local copy is only an offline cache.
        if (cloudEnvelope) {
          storeLocalVaultKeyEnvelope(userId, cloudEnvelope);
        } else {
          await clearLocalVault(userId);
        }
        envelopeRef.current = cloudEnvelope;
        setSyncStatus("synced");
        setStatus(cloudEnvelope ? "locked" : "new");
      } catch (hydrateError) {
        if (hydrateError instanceof SessionExpiredError) {
          onSessionExpired();
          return;
        }
        if (!isCancelled) {
          envelopeRef.current = localEnvelope;
          setSyncStatus("offline");
          // Only a confirmed "no vault" response may lead to setup; an error could hide a vault.
          setStatus(localEnvelope ? "locked" : "unavailable");
        }
      }
    }
    void hydrate();
    return () => {
      isCancelled = true;
    };
  }, [hydrateAttempt, onSessionExpired, userId]);

  const canRetry = hydrateAttempt < MAX_HYDRATE_RETRIES;

  function retry(): void {
    if (!canRetry) {
      return;
    }
    setStatus("loading");
    setHydrateAttempt((attempt) => attempt + 1);
  }

  const lock = useCallback((): void => {
    keyRef.current = null;
    setData(null);
    setUnreadableItemCount(0);
    setError("");
    setStatus(envelopeRef.current ? "locked" : "new");
  }, []);

  /** Locks and hands off to sign-in when the server rejects the session. */
  function handleSessionExpired(caughtError: unknown): boolean {
    if (!(caughtError instanceof SessionExpiredError)) {
      return false;
    }
    lock();
    onSessionExpired();
    return true;
  }

  useEffect(() => {
    if (status !== "unlocked") {
      return;
    }
    let timer = window.setTimeout(lock, AUTO_LOCK_MS);
    const resetTimer = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, AUTO_LOCK_MS);
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [lock, status]);

  async function setup(passphrase: string): Promise<boolean> {
    setError("");
    try {
      const created = await createVault(passphrase);
      await storeCloudVaultKeyEnvelope(created.envelope);
      storeLocalVaultKeyEnvelope(userId, created.envelope);
      storeLocalEncryptedItems(userId, []);
      envelopeRef.current = created.envelope;
      keyRef.current = created.key;
      setData(created.data);
      setStatus("unlocked");
      setSyncStatus("synced");
      return true;
    } catch (setupError) {
      if (handleSessionExpired(setupError)) {
        return false;
      }
      if (setupError instanceof VaultAlreadyExistsError) {
        retry();
        setError("This account already has a vault. Unlock it with its passphrase.");
        return false;
      }
      setError("An internet connection is required to create the vault.");
      return false;
    }
  }

  async function unlock(passphrase: string): Promise<boolean> {
    const envelope = envelopeRef.current;
    if (!envelope) {
      return false;
    }
    setError("");
    let key: CryptoKey;
    try {
      key = await unlockVaultKey(envelope, passphrase);
    } catch {
      setError("That vault passphrase did not work.");
      return false;
    }
    // Never sync or trust cached rows that this vault key cannot authenticate.
    const localItems = (
      await decryptReadableItems(key, getLocalEncryptedItems(userId))
    ).encryptedItems;
    let encryptedItems: EncryptedVaultItem[];
    try {
      const cloudItems = await getCloudEncryptedItems();
      const reconciled = reconcileEncryptedItems(localItems, cloudItems);
      encryptedItems = reconciled.items;
      try {
        await Promise.all(reconciled.itemsToUpload.map(storeCloudEncryptedItem));
        setSyncStatus("synced");
      } catch (uploadError) {
        if (handleSessionExpired(uploadError)) {
          return false;
        }
        setSyncStatus("offline");
      }
    } catch (loadError) {
      if (handleSessionExpired(loadError)) {
        return false;
      }
      if (!hasLocalEncryptedItemCache(userId)) {
        setError("Could not load encrypted vault items. Check your connection and try again.");
        return false;
      }
      encryptedItems = localItems;
      setSyncStatus("offline");
    }
    // Unreadable rows stay on the server untouched; they are only hidden and left uncached.
    const readable = await decryptReadableItems(key, encryptedItems);
    const nextData: VaultData = { items: readable.items };
    try {
      storeLocalEncryptedItems(userId, readable.encryptedItems);
    } catch (cacheError) {
      // The offline cache is optional; the vault still opens from the server copy.
      console.warn("Could not cache encrypted vault items on this device.", cacheError);
    }
    setUnreadableItemCount(encryptedItems.length - readable.encryptedItems.length);
    keyRef.current = key;
    setData(nextData);
    setStatus("unlocked");
    const expiredItems = nextData.items.filter((item) => (
      item.deletedAt
      && Date.now() - new Date(item.deletedAt).getTime() >= TRASH_RETENTION_MS
    ));
    if (expiredItems.length) {
      void (async () => {
        try {
          await Promise.all(expiredItems.map(async (item) => {
            await Promise.all(
              item.documents.map((document) => deleteEncryptedDocument(userId, document.id)),
            );
            await deleteCloudEncryptedItem(item.id);
            deleteLocalEncryptedItem(userId, item.id);
          }));
          setData((current) => current ? {
            items: current.items.filter((item) => !expiredItems.includes(item)),
          } : null);
        } catch (cleanupError) {
          if (handleSessionExpired(cleanupError)) {
            return;
          }
          setSyncStatus("offline");
        }
      })();
    }
    return true;
  }

  async function changePassphrase(
    currentPassphrase: string,
    newPassphrase: string,
  ): Promise<boolean> {
    const envelope = envelopeRef.current;
    if (!envelope || !keyRef.current) {
      return false;
    }
    setError("");
    let nextEnvelope: VaultKeyEnvelope;
    try {
      nextEnvelope = await rewrapVaultKey(envelope, currentPassphrase, newPassphrase);
    } catch {
      setError("That vault passphrase did not work.");
      return false;
    }
    try {
      // The server cannot check the new envelope, so prove it opens before replacing the old one.
      await unlockVaultKey(nextEnvelope, newPassphrase);
    } catch {
      setError("Could not verify the new passphrase. Your passphrase was not changed.");
      return false;
    }
    try {
      await replaceCloudVaultKeyEnvelope(envelope.wrappedKey, nextEnvelope);
    } catch (changeError) {
      if (handleSessionExpired(changeError)) {
        return false;
      }
      if (changeError instanceof VaultPassphraseConflictError) {
        // Adopt the newer envelope so the next unlock uses the other device's passphrase.
        const cloudEnvelope = await getCloudVaultKeyEnvelope().catch(() => null);
        if (cloudEnvelope) {
          envelopeRef.current = cloudEnvelope;
          storeLocalVaultKeyEnvelope(userId, cloudEnvelope);
        }
        setError("The passphrase was changed on another device. Lock the vault and unlock it again.");
        return false;
      }
      setError("An internet connection is required to change the passphrase.");
      return false;
    }
    envelopeRef.current = nextEnvelope;
    storeLocalVaultKeyEnvelope(userId, nextEnvelope);
    return true;
  }

  async function persistItem(item: VaultItem, nextItems: VaultItem[]): Promise<void> {
    const key = keyRef.current;
    if (!key) {
      throw new Error("Vault is locked.");
    }
    const encryptedItem = await encryptVaultItem(key, item);
    setData({ items: nextItems });
    upsertLocalEncryptedItem(userId, encryptedItem);
    setSyncStatus("syncing");
    try {
      await storeCloudEncryptedItem(encryptedItem);
      setSyncStatus("synced");
    } catch (syncError) {
      // The encrypted edit stays in this user's cache and syncs after signing back in.
      if (handleSessionExpired(syncError)) {
        return;
      }
      setSyncStatus("offline");
    }
  }

  async function saveItem(item: VaultItem): Promise<void> {
    if (!data) {
      return;
    }
    const exists = data.items.some((candidate) => candidate.id === item.id);
    const items = exists
      ? data.items.map((candidate) => (candidate.id === item.id ? item : candidate))
      : [item, ...data.items];
    await persistItem(item, items);
  }

  async function moveToTrash(id: string): Promise<void> {
    if (!data) {
      return;
    }
    const now = new Date().toISOString();
    const item = data.items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }
    const nextItem = { ...item, deletedAt: now, updatedAt: now };
    await persistItem(
      nextItem,
      data.items.map((candidate) => candidate.id === id ? nextItem : candidate),
    );
  }

  async function restoreItem(id: string): Promise<void> {
    if (!data) {
      return;
    }
    const item = data.items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }
    const nextItem = { ...item, deletedAt: null, updatedAt: new Date().toISOString() };
    await persistItem(
      nextItem,
      data.items.map((candidate) => candidate.id === id ? nextItem : candidate),
    );
  }

  async function permanentlyDelete(id: string): Promise<void> {
    if (!data) {
      return;
    }
    const item = data.items.find((candidate) => candidate.id === id);
    try {
      await Promise.all(
        item?.documents.map((document) => deleteEncryptedDocument(userId, document.id)) ?? [],
      );
      await deleteCloudEncryptedItem(id);
      deleteLocalEncryptedItem(userId, id);
      setData({ items: data.items.filter((candidate) => candidate.id !== id) });
      setSyncStatus("synced");
    } catch (deleteError) {
      if (handleSessionExpired(deleteError)) {
        return;
      }
      setSyncStatus("offline");
      setError("Could not permanently delete this item. Try again while online.");
    }
  }

  async function addDocument(file: File): Promise<VaultDocument> {
    const key = keyRef.current;
    if (!key) {
      throw new Error("Vault is locked.");
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new Error("Documents must be 25 MB or smaller.");
    }
    const id = crypto.randomUUID();
    let encryptionIv: string;
    try {
      encryptionIv = await storeEncryptedDocument(userId, id, file, key);
    } catch (uploadError) {
      handleSessionExpired(uploadError);
      throw uploadError;
    }
    return {
      id,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      createdAt: new Date().toISOString(),
      encryptionIv,
    };
  }

  async function downloadDocument(document: VaultDocument): Promise<void> {
    const key = keyRef.current;
    if (!key) {
      throw new Error("Vault is locked.");
    }
    let data: ArrayBuffer;
    try {
      data = await getDecryptedDocument(userId, document, key);
    } catch (downloadError) {
      handleSessionExpired(downloadError);
      throw downloadError;
    }
    const url = URL.createObjectURL(new Blob([data], { type: document.mimeType }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearLocalData(): Promise<void> {
    lock();
    await clearLocalVault(userId);
  }

  return {
    addDocument,
    canRetry,
    changePassphrase,
    clearLocalData,
    data,
    downloadDocument,
    error,
    lock,
    moveToTrash,
    permanentlyDelete,
    restoreItem,
    retry,
    saveItem,
    setup,
    status,
    syncStatus,
    unlock,
    unreadableItemCount,
  };
}
