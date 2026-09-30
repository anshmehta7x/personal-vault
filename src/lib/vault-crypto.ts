import { argon2id } from "hash-wasm";

import type {
  EncryptedVaultItem,
  VaultData,
  VaultItem,
  VaultKeyEnvelope,
} from "@/types/vault";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const WRAP_CONTEXT = encoder.encode("locker:v1:vault-key");

function getItemContext(itemId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`locker:v2:item:${itemId}`);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyBytes = await argon2id({
    password: passphrase,
    salt,
    iterations: 3,
    parallelism: 1,
    memorySize: 64 * 1024,
    hashLength: 32,
    outputType: "binary",
  });
  const rawKey = Uint8Array.from(keyBytes);
  try {
    return await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    keyBytes.fill(0);
    rawKey.fill(0);
  }
}

/** Imports the vault key so page scripts can use it but never export its raw bytes. */
function importVaultKey(rawKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(
  key: CryptoKey,
  value: BufferSource,
  context: Uint8Array<ArrayBuffer>,
): Promise<{ cipherText: string; iv: string }> {
  const iv = randomBytes(12);
  const result = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: context },
    key,
    value,
  );
  return {
    cipherText: bytesToBase64(new Uint8Array(result)),
    iv: bytesToBase64(iv),
  };
}

async function decrypt(
  key: CryptoKey,
  cipherText: string,
  iv: string,
  context: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv), additionalData: context },
    key,
    base64ToBytes(cipherText),
  );
}

export async function createVault(passphrase: string): Promise<{
  data: VaultData;
  envelope: VaultKeyEnvelope;
  key: CryptoKey;
}> {
  const salt = randomBytes(16);
  const passphraseKey = await derivePassphraseKey(passphrase, salt);
  // Extractable only long enough to wrap it; the returned key is a non-extractable copy.
  const extractableKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", extractableKey));
  try {
    const wrapped = await encrypt(passphraseKey, rawKey, WRAP_CONTEXT);
    const data: VaultData = { items: [] };
    return {
      data,
      envelope: {
        cryptoVersion: 1,
        kdfSalt: bytesToBase64(salt),
        wrapIv: wrapped.iv,
        wrappedKey: wrapped.cipherText,
      },
      key: await importVaultKey(rawKey),
    };
  } finally {
    rawKey.fill(0);
  }
}

export async function unlockVaultKey(
  envelope: VaultKeyEnvelope,
  passphrase: string,
): Promise<CryptoKey> {
  const passphraseKey = await derivePassphraseKey(passphrase, base64ToBytes(envelope.kdfSalt));
  const rawKey = new Uint8Array(await decrypt(
    passphraseKey,
    envelope.wrappedKey,
    envelope.wrapIv,
    WRAP_CONTEXT,
  ));
  try {
    return await importVaultKey(rawKey);
  } finally {
    rawKey.fill(0);
  }
}

/** Re-wraps the existing vault key under a new passphrase; item ciphertext stays valid. */
export async function rewrapVaultKey(
  envelope: VaultKeyEnvelope,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<VaultKeyEnvelope> {
  const currentKey = await derivePassphraseKey(
    currentPassphrase,
    base64ToBytes(envelope.kdfSalt),
  );
  const rawKey = new Uint8Array(await decrypt(
    currentKey,
    envelope.wrappedKey,
    envelope.wrapIv,
    WRAP_CONTEXT,
  ));
  try {
    const salt = randomBytes(16);
    const newKey = await derivePassphraseKey(newPassphrase, salt);
    const wrapped = await encrypt(newKey, rawKey, WRAP_CONTEXT);
    return {
      cryptoVersion: 1,
      kdfSalt: bytesToBase64(salt),
      wrapIv: wrapped.iv,
      wrappedKey: wrapped.cipherText,
    };
  } finally {
    rawKey.fill(0);
  }
}

export async function encryptVaultItem(
  key: CryptoKey,
  item: VaultItem,
): Promise<EncryptedVaultItem> {
  const encrypted = await encrypt(
    key,
    encoder.encode(JSON.stringify(item)),
    getItemContext(item.id),
  );
  return {
    itemId: item.id,
    cryptoVersion: 1,
    encryptionIv: encrypted.iv,
    encryptedPayload: encrypted.cipherText,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  };
}

export async function decryptVaultItem(
  key: CryptoKey,
  encryptedItem: EncryptedVaultItem,
): Promise<VaultItem> {
  const plainText = await decrypt(
    key,
    encryptedItem.encryptedPayload,
    encryptedItem.encryptionIv,
    getItemContext(encryptedItem.itemId),
  );
  const item = JSON.parse(decoder.decode(plainText)) as VaultItem;
  if (item.id !== encryptedItem.itemId) {
    throw new Error("Encrypted vault item ID does not match its row.");
  }
  return item;
}

export async function encryptDocument(
  key: CryptoKey,
  data: ArrayBuffer,
): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { encrypted, iv };
}

export async function decryptDocument(
  key: CryptoKey,
  encrypted: ArrayBuffer,
  iv: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
}
