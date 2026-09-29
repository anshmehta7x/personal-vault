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

const VAULT_KEY = "locker:vault-key:v1";
const VAULT_ITEMS_KEY = "locker:vault-items:v2";
const DATABASE_NAME = "locker-documents";
const STORE_NAME = "documents";

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

export function getLocalVaultKeyEnvelope(): VaultKeyEnvelope | null {
  const value = localStorage.getItem(VAULT_KEY);
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

export function storeLocalVaultKeyEnvelope(envelope: VaultKeyEnvelope): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
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

export function getLocalEncryptedItems(): EncryptedVaultItem[] {
  const value = localStorage.getItem(VAULT_ITEMS_KEY);
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

export function hasLocalEncryptedItemCache(): boolean {
  const value = localStorage.getItem(VAULT_ITEMS_KEY);
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

export function storeLocalEncryptedItems(items: EncryptedVaultItem[]): void {
  localStorage.setItem(VAULT_ITEMS_KEY, JSON.stringify(items));
}

export function upsertLocalEncryptedItem(item: EncryptedVaultItem): void {
  const current = getLocalEncryptedItems();
  const exists = current.some((candidate) => candidate.itemId === item.itemId);
  storeLocalEncryptedItems(exists
    ? current.map((candidate) => candidate.itemId === item.itemId ? item : candidate)
    : [item, ...current]);
}

export function deleteLocalEncryptedItem(itemId: string): void {
  storeLocalEncryptedItems(
    getLocalEncryptedItems().filter((item) => item.itemId !== itemId),
  );
}

function openDocumentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeEncryptedDocument(
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
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ id, encrypted, iv } satisfies StoredDocument);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return bytesToBase64(iv);
}

async function getLocalDocument(id: string): Promise<StoredDocument | null> {
  const database = await openDocumentDatabase();
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
  document: VaultDocument,
  key: CryptoKey,
): Promise<ArrayBuffer> {
  const localDocument = await getLocalDocument(document.id);
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

export async function deleteEncryptedDocument(id: string): Promise<void> {
  const cloudDelete = fetch(`/api/documents/${id}`, { method: "DELETE" });
  const database = await openDocumentDatabase();
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
