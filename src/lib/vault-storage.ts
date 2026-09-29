import type {
  EncryptedVaultItem,
  VaultDocument,
  VaultKeyEnvelope,
} from "@/types/vault";

import {
  base64ToBytes,
  bytesToBase64,
  decryptDocument,
  encryptDocument,
} from "./vault-crypto";

const STORE_NAME = "documents";

function getVaultKeyStorageKey(userId: string): string {
  return `locker:${userId}:vault-key:v1`;
}

function getVaultItemsStorageKey(userId: string): string {
  return `locker:${userId}:vault-items:v2`;
}

function getDatabaseName(userId: string): string {
  return `locker-documents:${userId}`;
}

interface StoredDocument {
  id: string;
  encrypted: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
}

function isVaultKeyEnvelope(value: unknown): value is VaultKeyEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const envelope = value as Partial<VaultKeyEnvelope>;
  return envelope.cryptoVersion === 1
    && typeof envelope.kdfSalt === "string"
    && typeof envelope.wrapIv === "string"
    && typeof envelope.wrappedKey === "string";
}

function parseVaultKeyEnvelope(value: string | null): VaultKeyEnvelope | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isVaultKeyEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getLocalVaultKeyEnvelope(userId: string): VaultKeyEnvelope | null {
  return parseVaultKeyEnvelope(localStorage.getItem(getVaultKeyStorageKey(userId)));
}

export function storeLocalVaultKeyEnvelope(userId: string, envelope: VaultKeyEnvelope): void {
  localStorage.setItem(getVaultKeyStorageKey(userId), JSON.stringify(envelope));
}

function isEncryptedVaultItem(value: unknown): value is EncryptedVaultItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<EncryptedVaultItem>;
  return typeof item.itemId === "string"
    && item.cryptoVersion === 1
    && typeof item.encryptionIv === "string"
    && typeof item.encryptedPayload === "string"
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string"
    && (typeof item.deletedAt === "string" || item.deletedAt === null);
}

function parseEncryptedItems(value: string | null): EncryptedVaultItem[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every(isEncryptedVaultItem) ? parsed : [];
  } catch {
    return [];
  }
}

export function getLocalEncryptedItems(userId: string): EncryptedVaultItem[] {
  return parseEncryptedItems(localStorage.getItem(getVaultItemsStorageKey(userId)));
}

export function hasLocalEncryptedItemCache(userId: string): boolean {
  const value = localStorage.getItem(getVaultItemsStorageKey(userId));
  if (!value) {
    return false;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every(isEncryptedVaultItem);
  } catch {
    return false;
  }
}

export function storeLocalEncryptedItems(userId: string, items: EncryptedVaultItem[]): void {
  localStorage.setItem(getVaultItemsStorageKey(userId), JSON.stringify(items));
}

export function upsertLocalEncryptedItem(userId: string, item: EncryptedVaultItem): void {
  const current = getLocalEncryptedItems(userId);
  const exists = current.some((candidate) => candidate.itemId === item.itemId);
  storeLocalEncryptedItems(userId, exists
    ? current.map((candidate) => candidate.itemId === item.itemId ? item : candidate)
    : [item, ...current]);
}

export function deleteLocalEncryptedItem(userId: string, itemId: string): void {
  storeLocalEncryptedItems(
    userId,
    getLocalEncryptedItems(userId).filter((item) => item.itemId !== itemId),
  );
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // Deletion completes once other tabs close their connections; don't block sign-out on it.
    request.onblocked = () => resolve();
  });
}

export async function clearLocalVault(userId: string): Promise<void> {
  localStorage.removeItem(getVaultKeyStorageKey(userId));
  localStorage.removeItem(getVaultItemsStorageKey(userId));
  await deleteDatabase(getDatabaseName(userId));
}

function openDocumentDatabase(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(getDatabaseName(userId), 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeEncryptedDocument(
  userId: string,
  id: string,
  file: File,
  key: CryptoKey,
): Promise<string> {
  const { encrypted, iv } = await encryptDocument(key, await file.arrayBuffer());
  const signingResponse = await fetch(`/api/documents/${id}`, { method: "POST" });
  if (!signingResponse.ok) {
    throw new Error("Could not prepare the private document upload.");
  }
  const { uploadUrl } = await signingResponse.json() as { uploadUrl: string };
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: encrypted,
  });
  if (!uploadResponse.ok) {
    throw new Error("The encrypted document upload failed.");
  }
  const database = await openDocumentDatabase(userId);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ id, encrypted, iv } satisfies StoredDocument);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return bytesToBase64(iv);
}

async function getLocalDocument(userId: string, id: string): Promise<StoredDocument | null> {
  const database = await openDocumentDatabase(userId);
  const document = await new Promise<StoredDocument | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      resolve(request.result ? request.result as StoredDocument : null);
    };
    request.onerror = () => reject(request.error);
  });
  database.close();
  return document;
}

export async function getDecryptedDocument(
  userId: string,
  document: VaultDocument,
  key: CryptoKey,
): Promise<ArrayBuffer> {
  const localDocument = await getLocalDocument(userId, document.id);
  if (localDocument) {
    return decryptDocument(key, localDocument.encrypted, new Uint8Array(localDocument.iv));
  }
  const signingResponse = await fetch(`/api/documents/${document.id}`, { cache: "no-store" });
  if (!signingResponse.ok) {
    throw new Error("Could not prepare the private document download.");
  }
  const { downloadUrl } = await signingResponse.json() as { downloadUrl: string };
  const downloadResponse = await fetch(downloadUrl, { cache: "no-store" });
  if (!downloadResponse.ok) {
    throw new Error("The encrypted document download failed.");
  }
  return decryptDocument(
    key,
    await downloadResponse.arrayBuffer(),
    base64ToBytes(document.encryptionIv),
  );
}

export async function deleteEncryptedDocument(userId: string, id: string): Promise<void> {
  const cloudDelete = fetch(`/api/documents/${id}`, { method: "DELETE" });
  const database = await openDocumentDatabase(userId);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const response = await cloudDelete;
  if (!response.ok) {
    throw new Error("Could not delete the encrypted cloud document.");
  }
}
