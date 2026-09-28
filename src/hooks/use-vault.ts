"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createVault, sealVault, unlockVault } from "@/lib/vault-crypto";
import {
  deleteEncryptedDocument,
  getCloudVaultRecord,
  getDecryptedDocument,
  getVaultRecord,
  storeCloudVaultRecord,
  storeEncryptedDocument,
  storeVaultRecord,
} from "@/lib/vault-storage";
import type { VaultData, VaultDocument, VaultItem, VaultRecord } from "@/types/vault";

type VaultStatus = "loading" | "new" | "locked" | "unlocked";
type SyncStatus = "syncing" | "synced" | "offline";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const AUTO_LOCK_MS = 10 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function useVault() {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [data, setData] = useState<VaultData | null>(null);
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");
  const keyRef = useRef<CryptoKey | null>(null);
  const recordRef = useRef<VaultRecord | null>(null);

  useEffect(() => {
    let isCancelled = false;
    async function hydrate(): Promise<void> {
      const localRecord = getVaultRecord();
      try {
        const cloudRecord = await getCloudVaultRecord();
        if (isCancelled) {
          return;
        }
        const record = !cloudRecord || (localRecord?.updatedAt ?? "") > cloudRecord.updatedAt
          ? localRecord
          : cloudRecord;
        if (record) {
          storeVaultRecord(record);
        }
        if (localRecord && record === localRecord && localRecord !== cloudRecord) {
          await storeCloudVaultRecord(localRecord);
        }
        recordRef.current = record;
        setSyncStatus("synced");
        setStatus(record ? "locked" : "new");
      } catch {
        if (!isCancelled) {
          recordRef.current = localRecord;
          setSyncStatus("offline");
          setStatus(localRecord ? "locked" : "new");
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
    setStatus(recordRef.current ? "locked" : "new");
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
      storeVaultRecord(created.record);
      recordRef.current = created.record;
      keyRef.current = created.key;
      setData(created.data);
      setStatus("unlocked");
      setSyncStatus("syncing");
      try {
        await storeCloudVaultRecord(created.record);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("offline");
      }
      return true;
    } catch {
      setError("Could not create the vault on this device.");
      return false;
    }
  }

  async function unlock(passphrase: string): Promise<boolean> {
    const record = recordRef.current;
    if (!record) {
      return false;
    }
    setError("");
    try {
      const unlocked = await unlockVault(record, passphrase);
      keyRef.current = unlocked.key;
      setData(unlocked.data);
      setStatus("unlocked");
      const expiredItems = unlocked.data.items.filter((item) => (
        item.deletedAt
        && Date.now() - new Date(item.deletedAt).getTime() >= TRASH_RETENTION_MS
      ));
      if (expiredItems.length) {
        void (async () => {
          try {
            await Promise.all(expiredItems.flatMap((item) => (
              item.documents.map((document) => deleteEncryptedDocument(document.id))
            )));
            await persist({
              items: unlocked.data.items.filter((item) => !expiredItems.includes(item)),
            });
          } catch {
            setSyncStatus("offline");
          }
        })();
      }
      return true;
    } catch {
      setError("That vault passphrase did not work.");
      return false;
    }
  }

  async function persist(nextData: VaultData): Promise<void> {
    const key = keyRef.current;
    const record = recordRef.current;
    if (!key || !record) {
      throw new Error("Vault is locked.");
    }
    setData(nextData);
    const nextRecord = await sealVault(record, key, nextData);
    storeVaultRecord(nextRecord);
    recordRef.current = nextRecord;
    setSyncStatus("syncing");
    try {
      await storeCloudVaultRecord(nextRecord);
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
    await persist({ items });
  }

  async function moveToTrash(id: string): Promise<void> {
    if (!data) {
      return;
    }
    await persist({
      items: data.items.map((item) =>
        item.id === id ? { ...item, deletedAt: new Date().toISOString() } : item,
      ),
    });
  }

  async function restoreItem(id: string): Promise<void> {
    if (!data) {
      return;
    }
    await persist({
      items: data.items.map((item) => (item.id === id ? { ...item, deletedAt: null } : item)),
    });
  }

  async function permanentlyDelete(id: string): Promise<void> {
    if (!data) {
      return;
    }
    const item = data.items.find((candidate) => candidate.id === id);
    await Promise.all(item?.documents.map((document) => deleteEncryptedDocument(document.id)) ?? []);
    await persist({ items: data.items.filter((candidate) => candidate.id !== id) });
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
