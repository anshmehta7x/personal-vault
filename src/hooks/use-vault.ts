"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createVault,
  decryptVaultItem,
  encryptVaultItem,
  unlockVault,
  unlockVaultKey,
} from "@/lib/vault-crypto";
import {
  deleteCloudEncryptedItem,
  getCloudEncryptedItems,
  getCloudVaultMetadata,
  storeCloudEncryptedItem,
  storeCloudVaultRecord,
} from "@/lib/vault-api";
import { migrateLegacyVault } from "@/lib/vault-migration";
import {
  deleteEncryptedDocument,
  deleteLocalEncryptedItem,
  getDecryptedDocument,
  getLocalEncryptedItems,
  getLocalVaultMetadata,
  hasLocalEncryptedItemCache,
  storeLocalEncryptedItems,
  storeLocalVaultMetadata,
  storeEncryptedDocument,
  upsertLocalEncryptedItem,
} from "@/lib/vault-storage";
import type {
  EncryptedVaultItem,
  VaultData,
  VaultDocument,
  VaultItem,
  VaultMetadata,
} from "@/types/vault";

type VaultStatus = "loading" | "new" | "locked" | "unlocked";
type SyncStatus = "syncing" | "synced" | "offline";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const AUTO_LOCK_MS = 10 * 60 * 1000;
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

export function useVault() {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");
  const keyRef = useRef<CryptoKey | null>(null);
  const metadataRef = useRef<VaultMetadata | null>(null);

  useEffect(() => {
    let isCancelled = false;
    async function hydrate(): Promise<void> {
      const localMetadata = getLocalVaultMetadata();
      try {
        const cloudMetadata = await getCloudVaultMetadata();
        if (isCancelled) {
          return;
        }
        let metadata = cloudMetadata;
        if (!cloudMetadata && localMetadata) {
          await storeCloudVaultRecord(localMetadata.record, localMetadata.storageVersion);
          metadata = localMetadata;
        } else if (cloudMetadata?.storageVersion === 1
          && localMetadata?.storageVersion === 1
          && localMetadata.record.updatedAt > cloudMetadata.record.updatedAt) {
          await storeCloudVaultRecord(localMetadata.record, 1);
          metadata = localMetadata;
        }
        if (metadata) {
          storeLocalVaultMetadata(metadata);
        }
        metadataRef.current = metadata;
        setSyncStatus("synced");
        setStatus(metadata ? "locked" : "new");
      } catch {
        if (!isCancelled) {
          metadataRef.current = localMetadata;
          setSyncStatus("offline");
          setStatus(localMetadata ? "locked" : "new");
        }
      }
    }
    void hydrate();
    return () => {
      isCancelled = true;
    };
  }, []);

  const lock = useCallback((): void => {
    keyRef.current = null;
    setData(null);
    setError("");
    setStatus(metadataRef.current ? "locked" : "new");
  }, []);

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
      const migratedAt = new Date().toISOString();
      const metadata: VaultMetadata = {
        record: created.record,
        storageVersion: 2,
        migratedAt,
      };
      await storeCloudVaultRecord(created.record, 2);
      storeLocalVaultMetadata(metadata);
      storeLocalEncryptedItems([]);
      metadataRef.current = metadata;
      keyRef.current = created.key;
      setData(created.data);
      setStatus("unlocked");
      setSyncStatus("synced");
      return true;
    } catch {
      setError("An internet connection is required to create the vault.");
      return false;
    }
  }

  async function unlock(passphrase: string): Promise<boolean> {
    const metadata = metadataRef.current;
    if (!metadata) {
      return false;
    }
    setError("");
    let key: CryptoKey;
    let nextData: VaultData;
    if (metadata.storageVersion === 1) {
      let unlocked: Awaited<ReturnType<typeof unlockVault>>;
      try {
        unlocked = await unlockVault(metadata.record, passphrase);
      } catch {
        setError("That vault passphrase did not work.");
        return false;
      }
      try {
        const migrated = await migrateLegacyVault(unlocked.data, unlocked.key);
        const nextMetadata: VaultMetadata = {
          ...metadata,
          storageVersion: 2,
          migratedAt: migrated.migratedAt,
        };
        storeLocalVaultMetadata(nextMetadata);
        metadataRef.current = nextMetadata;
        key = unlocked.key;
        nextData = unlocked.data;
        setSyncStatus("synced");
      } catch {
        setError("Could not migrate the encrypted vault. Check your connection and try again.");
        return false;
      }
    } else {
      try {
        key = await unlockVaultKey(metadata.record, passphrase);
      } catch {
        setError("That vault passphrase did not work.");
        return false;
      }
      const localItems = getLocalEncryptedItems();
      let encryptedItems: EncryptedVaultItem[];
      try {
        const cloudItems = await getCloudEncryptedItems();
        const reconciled = reconcileEncryptedItems(localItems, cloudItems);
        encryptedItems = reconciled.items;
        storeLocalEncryptedItems(encryptedItems);
        try {
          await Promise.all(reconciled.itemsToUpload.map(storeCloudEncryptedItem));
          setSyncStatus("synced");
        } catch {
          setSyncStatus("offline");
        }
      } catch {
        if (!hasLocalEncryptedItemCache()) {
          setError("Could not load encrypted vault items. Check your connection and try again.");
          return false;
        }
        encryptedItems = localItems;
        setSyncStatus("offline");
      }
      try {
        nextData = {
          items: await Promise.all(
            encryptedItems.map((item) => decryptVaultItem(key, item)),
          ),
        };
      } catch {
        setError("Could not decrypt the stored vault items.");
        return false;
      }
    }
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
              item.documents.map((document) => deleteEncryptedDocument(document.id)),
            );
            await deleteCloudEncryptedItem(item.id);
            deleteLocalEncryptedItem(item.id);
          }));
          setData((current) => current ? {
            items: current.items.filter((item) => !expiredItems.includes(item)),
          } : null);
        } catch {
          setSyncStatus("offline");
        }
      })();
    }
    return true;
  }

  async function persistItem(item: VaultItem, nextItems: VaultItem[]): Promise<void> {
    const key = keyRef.current;
    if (!key) {
      throw new Error("Vault is locked.");
    }
    const encryptedItem = await encryptVaultItem(key, item);
    setData({ items: nextItems });
    upsertLocalEncryptedItem(encryptedItem);
    setSyncStatus("syncing");
    try {
      await storeCloudEncryptedItem(encryptedItem);
      setSyncStatus("synced");
    } catch {
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
        item?.documents.map((document) => deleteEncryptedDocument(document.id)) ?? [],
      );
      await deleteCloudEncryptedItem(id);
      deleteLocalEncryptedItem(id);
      setData({ items: data.items.filter((candidate) => candidate.id !== id) });
      setSyncStatus("synced");
    } catch {
      setSyncStatus("offline");
      setError("Could not permanently delete this item. Try again while online.");
    }
  }

  async function addDocument(file: File): Promise<VaultDocument> {
    const key = keyRef.current;
    if (!key) {
      throw new Error("Vault is locked.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("Documents must be 25 MB or smaller.");
    }
    const id = crypto.randomUUID();
    const encryptionIv = await storeEncryptedDocument(id, file, key);
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
    const data = await getDecryptedDocument(document, key);
    const url = URL.createObjectURL(new Blob([data], { type: document.mimeType }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.name;
    link.click();
    URL.revokeObjectURL(url);
  }

  return {
    addDocument,
    data,
    downloadDocument,
    error,
    lock,
    moveToTrash,
    permanentlyDelete,
    restoreItem,
    saveItem,
    setup,
    status,
    syncStatus,
    unlock,
  };
}
