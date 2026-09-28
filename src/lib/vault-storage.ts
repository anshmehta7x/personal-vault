import type { VaultDocument, VaultRecord } from "@/types/vault";

import {
  base64ToBytes,
  bytesToBase64,
  decryptDocument,
  encryptDocument,
} from "./vault-crypto";

const VAULT_KEY = "locker:vault";
const DATABASE_NAME = "locker-documents";
const STORE_NAME = "documents";

interface StoredDocument {
  id: string;
  encrypted: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
}

export function getVaultRecord(): VaultRecord | null {
  const value = localStorage.getItem(VAULT_KEY);
  if (!value) {
    return null;
  }
  try {
    const record = JSON.parse(value) as VaultRecord;
    if (record.version !== 1) {
      return null;
    }
    return {
      ...record,
      updatedAt: record.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function storeVaultRecord(record: VaultRecord): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(record));
}

export async function getCloudVaultRecord(): Promise<VaultRecord | null> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load the cloud vault.");
  }
  const body = await response.json() as { record: VaultRecord | null };
  return body.record;
}

export async function storeCloudVaultRecord(record: VaultRecord): Promise<void> {
  const response = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!response.ok) {
    throw new Error("Could not sync the encrypted vault.");
  }
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
