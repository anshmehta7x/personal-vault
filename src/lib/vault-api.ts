import type {
  EncryptedVaultItem,
  VaultKeyEnvelope,
} from "@/types/vault";

export class VaultAlreadyExistsError extends Error {
  constructor() {
    super("This account already has a vault.");
    this.name = "VaultAlreadyExistsError";
  }
}

export class VaultPassphraseConflictError extends Error {
  constructor() {
    super("The vault passphrase was changed elsewhere.");
    this.name = "VaultPassphraseConflictError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in again.");
    this.name = "SessionExpiredError";
  }
}

export function throwIfSessionExpired(response: Response): void {
  if (response.status === 401) {
    throw new SessionExpiredError();
  }
}

export async function getCloudVaultKeyEnvelope(): Promise<VaultKeyEnvelope | null> {
  const response = await fetch("/api/vault", { cache: "no-store" });
  throwIfSessionExpired(response);
  if (!response.ok) {
    throw new Error("Could not load the cloud vault.");
  }
  const body = await response.json() as { keyEnvelope: VaultKeyEnvelope | null };
  return body.keyEnvelope;
}

export async function storeCloudVaultKeyEnvelope(envelope: VaultKeyEnvelope): Promise<void> {
  const response = await fetch("/api/vault", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  throwIfSessionExpired(response);
  if (response.status === 409) {
    throw new VaultAlreadyExistsError();
  }
  if (!response.ok) {
    throw new Error("Could not sync the vault key envelope.");
  }
}

/** Replaces the envelope only if the server still holds the one identified by its wrapped key. */
export async function replaceCloudVaultKeyEnvelope(
  expectedWrappedKey: string,
  envelope: VaultKeyEnvelope,
): Promise<void> {
  const response = await fetch("/api/vault", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedWrappedKey, keyEnvelope: envelope }),
  });
  throwIfSessionExpired(response);
  if (response.status === 409) {
    throw new VaultPassphraseConflictError();
  }
  if (!response.ok) {
    throw new Error("Could not change the vault passphrase.");
  }
}

export async function getCloudEncryptedItems(): Promise<EncryptedVaultItem[]> {
  const response = await fetch("/api/vault/items", { cache: "no-store" });
  throwIfSessionExpired(response);
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
  throwIfSessionExpired(response);
  if (!response.ok) {
    throw new Error("Could not sync the encrypted vault item.");
  }
}

export async function deleteCloudEncryptedItem(itemId: string): Promise<void> {
  const response = await fetch(`/api/vault/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  throwIfSessionExpired(response);
  if (!response.ok) {
    throw new Error("Could not delete the encrypted vault item.");
  }
}
