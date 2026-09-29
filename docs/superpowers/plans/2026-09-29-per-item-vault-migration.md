# Per-item Vault Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the single-owner vault from one encrypted data blob to independently encrypted database rows without losing any existing item or custom field.

**Architecture:** Keep `vaults` as the wrapped-key envelope and migration marker, and add `vault_items` for independently encrypted `VaultItem` payloads. An authenticated browser unlocks the legacy blob, encrypts and uploads each item, verifies the decrypted round trip, and only then activates storage version 2; the legacy ciphertext remains as a recovery copy.

**Tech Stack:** Next.js 16 App Router route handlers, React 19, TypeScript 5.9, Web Crypto AES-256-GCM, Argon2id via `hash-wasm`, Neon Postgres, Zod 4.

**Spec:** `docs/superpowers/specs/2026-09-29-per-item-vault-migration-design.md`

## Global Constraints

- Preserve every existing item, custom field, note, document reference, timestamp, and trash state.
- Never send the vault passphrase, unwrapped vault key, or plaintext item data to the server.
- Retain the legacy encrypted blob unchanged as a recovery copy.
- Use `locker:v2:item:<item-id>` as AES-GCM additional authenticated data for each item.
- Block editing until a legacy migration has uploaded and verified every item.
- Do not move or re-encrypt document object bytes; only their encrypted item metadata moves.
- Do not add automated tests, per the owner's explicit request.
- Run lint, production build, and the manual data-integrity checks before completion.
- Follow the repository's two-space TypeScript style and explicit argument/return types.

## Review Focus

- Interrupted migration: close the browser before activation, unlock again, and confirm idempotent upserts complete without duplicates.
- Empty legacy vault: confirm an expected empty ID set activates version 2 with zero item rows.
- Corrupt or swapped ciphertext: confirm item-bound AES-GCM decryption fails and activation does not occur.
- Offline migrated vault: confirm cached encrypted item rows unlock locally and display offline status.
- Exact preservation: compare every migrated item payload, including ordered custom fields and document metadata, before activation.

---

### Task 1: Commit the Neon schema migration

**Files:**
- Create: `migrations/0003_create_vault_items.sql`

**Interfaces:**
- Consumes: Existing `vaults(user_id)` unique constraint from `migrations/0001_create_vaults.sql`.
- Produces: `vaults.storage_version`, `vaults.migrated_at`, and the `vault_items` table used by all new API routes.

- [ ] **Step 1: Create the idempotent migration**

Add exactly this schema migration:

```sql
BEGIN;

ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS storage_version SMALLINT NOT NULL DEFAULT 1
    CHECK (storage_version IN (1, 2));

ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS vault_items (
  user_id TEXT NOT NULL,
  item_id UUID NOT NULL,
  crypto_version SMALLINT NOT NULL DEFAULT 1 CHECK (crypto_version = 1),
  encryption_iv TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, item_id),
  CONSTRAINT vault_items_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES vaults (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_items_user_id_updated_at
  ON vault_items (user_id, updated_at DESC);

COMMIT;
```

- [ ] **Step 2: Check the migration without applying it**

Run:

```bash
git diff --check -- migrations/0003_create_vault_items.sql
sed -n '1,220p' migrations/0003_create_vault_items.sql
```

Expected: no whitespace errors; the displayed SQL matches the approved schema. Do not run it against production during implementation.

- [ ] **Step 3: Commit the schema migration**

```bash
git add migrations/0003_create_vault_items.sql
git commit -m "feat: add per-item vault storage schema"
```

### Task 2: Define encrypted-item types and crypto primitives

**Files:**
- Modify: `src/types/vault.ts`
- Modify: `src/lib/vault-crypto.ts`

**Interfaces:**
- Consumes: Existing `VaultItem`, `VaultData`, `VaultRecord`, and AES-GCM helpers.
- Produces: `VaultStorageVersion`, `VaultMetadata`, `EncryptedVaultItem`, `unlockVaultKey()`, `encryptVaultItem()`, and `decryptVaultItem()`.

- [ ] **Step 1: Add storage and ciphertext types**

Append these interfaces in `src/types/vault.ts` while retaining the legacy `VaultRecord` shape:

```ts
export type VaultStorageVersion = 1 | 2;

export interface VaultMetadata {
  record: VaultRecord;
  storageVersion: VaultStorageVersion;
  migratedAt: string | null;
}

export interface EncryptedVaultItem {
  itemId: string;
  cryptoVersion: 1;
  encryptionIv: string;
  encryptedPayload: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

`VaultRecord` stays unchanged because version-1 rows and the local cache still need `dataIv` and `encryptedData` to perform or recover the migration.

- [ ] **Step 2: Separate key unwrapping from legacy data decryption**

Extract the key derivation and unwrap portion of `unlockVault()` into:

```ts
export async function unlockVaultKey(
  record: VaultRecord,
  passphrase: string,
): Promise<CryptoKey> {
  const passphraseKey = await derivePassphraseKey(passphrase, base64ToBytes(record.salt));
  const rawKey = await decrypt(
    passphraseKey,
    record.wrappedKey,
    record.wrapIv,
    WRAP_CONTEXT,
  );
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"]);
}
```

Change `unlockVault()` to call `unlockVaultKey()` and then decrypt the legacy `encryptedData`. This preserves its current signature for storage-version-1 unlocks.

- [ ] **Step 3: Add item-bound encryption and decryption**

Add an item context helper and the two public functions:

```ts
function getItemContext(itemId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`locker:v2:item:${itemId}`);
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
```

Import `EncryptedVaultItem` and `VaultItem` with the existing vault types.

- [ ] **Step 4: Run static checks and commit**

```bash
npm run lint
git diff --check
git add src/types/vault.ts src/lib/vault-crypto.ts
git commit -m "feat: encrypt vault items independently"
```

Expected: lint passes and no formatting errors are reported.

### Task 3: Add ciphertext-only item and activation APIs

**Files:**
- Modify: `src/app/api/vault/route.ts`
- Create: `src/app/api/vault/items/route.ts`
- Create: `src/app/api/vault/items/[id]/route.ts`
- Create: `src/app/api/vault/migration/route.ts`

**Interfaces:**
- Consumes: `getAuthenticatedUserId(request)`, `sql`, and the Task 1 columns/table.
- Produces: `GET /api/vault`, `PUT /api/vault`, `GET /api/vault/items`, `PUT /api/vault/items/[id]`, `DELETE /api/vault/items/[id]`, and `PUT /api/vault/migration`.

- [ ] **Step 1: Return and persist vault storage metadata**

Change `GET /api/vault` to select `encrypted_record`, `storage_version`, and `migrated_at`, returning:

```ts
return Response.json({
  metadata: rows[0] ? {
    record: rows[0].encrypted_record,
    storageVersion: rows[0].storage_version,
    migratedAt: rows[0].migrated_at,
  } : null,
}, { headers: { "Cache-Control": "no-store" } });
```

Change the PUT body to `{ record, storageVersion }`. Validate `storageVersion` as `1 | 2`. On insert, use the supplied version so new empty vaults start at version 2, and set `migrated_at` immediately for those new version-2 vaults. On conflict, update only `encrypted_record` and `updated_at`; never let this general endpoint change an existing row's `storage_version`.

```sql
INSERT INTO vaults (user_id, encrypted_record, storage_version, migrated_at)
VALUES (
  ${userId},
  ${encryptedRecord}::jsonb,
  ${storageVersion},
  CASE WHEN ${storageVersion} = 2 THEN NOW() ELSE NULL END
)
ON CONFLICT (user_id)
DO UPDATE SET
  encrypted_record = EXCLUDED.encrypted_record,
  updated_at = NOW()
```

- [ ] **Step 2: Add the encrypted-item list route**

Implement authenticated `GET /api/vault/items`. Select only the current user's rows, map snake_case columns to `EncryptedVaultItem`, order by `updated_at DESC`, and return `{ items }` with `Cache-Control: no-store`.

Return `401` without a session. Do not accept `user_id` through query parameters or request bodies.

- [ ] **Step 3: Add item upsert and delete routes**

Use a dynamic route context compatible with Next.js 16:

```ts
interface RouteContext {
  params: Promise<{ id: string }>;
}
```

Validate `id` with `z.string().uuid()`. Validate the PUT body with exact fields matching `EncryptedVaultItem`, then reject a body whose `itemId` differs from the path ID.

Upsert with:

```sql
INSERT INTO vault_items (
  user_id,
  item_id,
  crypto_version,
  encryption_iv,
  encrypted_payload,
  created_at,
  updated_at,
  deleted_at
)
VALUES (
  ${userId},
  ${item.itemId},
  ${item.cryptoVersion},
  ${item.encryptionIv},
  ${item.encryptedPayload},
  ${item.createdAt},
  ${item.updatedAt},
  ${item.deletedAt}
)
ON CONFLICT (user_id, item_id)
DO UPDATE SET
  crypto_version = EXCLUDED.crypto_version,
  encryption_iv = EXCLUDED.encryption_iv,
  encrypted_payload = EXCLUDED.encrypted_payload,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at
```

`DELETE` removes only `WHERE user_id = ${userId} AND item_id = ${id}`. Return `401` for no session, `400` for invalid IDs or payloads, and `{ saved: true }` / `{ deleted: true }` for success.

- [ ] **Step 4: Add exact-set migration activation**

Validate `{ expectedItemIds: string[] }` as unique UUIDs. Convert the array to JSON and use one SQL statement whose CTEs:

1. turn the JSON array into an `expected(item_id)` relation;
2. select `actual(item_id)` for the authenticated user;
3. require no IDs in either `expected EXCEPT actual` or `actual EXCEPT expected`; and
4. update that user's `vaults` row to `storage_version = 2`, `migrated_at = COALESCE(migrated_at, NOW())` only when the sets match.

The update must accept both version 1 and an already-activated version 2 so a lost HTTP response can be retried idempotently. Return `409` when the exact sets do not match and `{ migrated: true, migratedAt }` on success.

- [ ] **Step 5: Run static checks and commit**

```bash
npm run lint
npm run build
git diff --check
git add src/app/api/vault
git commit -m "feat: add per-item vault APIs"
```

Expected: lint and the production build pass.

### Task 4: Add browser cache, API client, and migration coordinator

**Files:**
- Modify: `src/lib/vault-storage.ts`
- Create: `src/lib/vault-api.ts`
- Create: `src/lib/vault-migration.ts`

**Interfaces:**
- Consumes: Task 2 types and crypto functions; Task 3 endpoints.
- Produces: local metadata/item cache functions, ciphertext API functions, and `migrateLegacyVault()`.

- [ ] **Step 1: Make the local metadata cache backward compatible**

Replace the raw-record local cache interface with:

```ts
export function getLocalVaultMetadata(): VaultMetadata | null;
export function storeLocalVaultMetadata(metadata: VaultMetadata): void;
```

When `locker:vault` parses as the old raw `VaultRecord`, return it as:

```ts
{
  record: parsedRecord,
  storageVersion: 1,
  migratedAt: null,
}
```

When it parses as the new wrapper, validate the record version and storage version before returning it. Write only the new wrapper shape.

- [ ] **Step 2: Add a versioned local encrypted-item cache**

Use `locker:vault-items:v2` and expose:

```ts
export function getLocalEncryptedItems(): EncryptedVaultItem[];
export function storeLocalEncryptedItems(items: EncryptedVaultItem[]): void;
export function upsertLocalEncryptedItem(item: EncryptedVaultItem): void;
export function deleteLocalEncryptedItem(itemId: string): void;
```

Parse failures return an empty array. Upsert by `itemId`, preserving all other rows immutably.

Leave the IndexedDB document functions unchanged.

- [ ] **Step 3: Move cloud vault calls into a focused API client**

Create `src/lib/vault-api.ts` with:

```ts
export async function getCloudVaultMetadata(): Promise<VaultMetadata | null>;
export async function storeCloudVaultRecord(
  record: VaultRecord,
  storageVersion: VaultStorageVersion,
): Promise<void>;
export async function getCloudEncryptedItems(): Promise<EncryptedVaultItem[]>;
export async function storeCloudEncryptedItem(item: EncryptedVaultItem): Promise<void>;
export async function deleteCloudEncryptedItem(itemId: string): Promise<void>;
export async function completeCloudMigration(expectedItemIds: string[]): Promise<string>;
```

Each function calls the Task 3 endpoint, checks `response.ok`, and throws a specific `Error` on failure. `completeCloudMigration()` returns the server's `migratedAt` value.

Keep document upload/download/delete networking in `vault-storage.ts`; it has separate object-storage responsibilities.

- [ ] **Step 4: Implement the retry-safe browser migration**

Create:

```ts
export async function migrateLegacyVault(
  data: VaultData,
  key: CryptoKey,
): Promise<{ encryptedItems: EncryptedVaultItem[]; migratedAt: string }>;
```

Its sequence is fixed:

```ts
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
```

Implement `verifyMigratedItems(expected, actual): void` with maps keyed by ID. Require equal map sizes, no duplicate IDs, every expected ID, and exact `JSON.stringify()` equality for each complete item payload. Throw `Error("Migrated vault items did not match the legacy vault.")` on any mismatch. This is a required runtime safety check, not an automated test.

- [ ] **Step 5: Run static checks and commit**

```bash
npm run lint
git diff --check
git add src/lib/vault-api.ts src/lib/vault-migration.ts src/lib/vault-storage.ts
git commit -m "feat: add retry-safe vault migration client"
```

Expected: lint passes.

### Task 5: Switch the vault hook to per-item persistence

**Files:**
- Modify: `src/hooks/use-vault.ts`

**Interfaces:**
- Consumes: Task 2 crypto functions, Task 4 metadata/cache/API/migration functions.
- Produces: unchanged `useVault()` component-facing API backed by per-item rows after migration.

- [ ] **Step 1: Hydrate storage metadata without decrypting**

Replace `recordRef` with `metadataRef: MutableRefObject<VaultMetadata | null>`. On mount:

- read `getLocalVaultMetadata()`;
- fetch `getCloudVaultMetadata()`;
- prefer cloud metadata when available and cache it locally;
- fall back to local metadata and `syncStatus = "offline"` on a network failure; and
- set `status` to `"locked"` when metadata exists or `"new"` otherwise.

Do not compare metadata `updatedAt` to decide item freshness after version 2; online item rows are authoritative.

- [ ] **Step 2: Create new vaults directly on storage version 2**

In `setup()`:

1. call `createVault(passphrase)`;
2. wrap its record as `{ record, storageVersion: 2, migratedAt: now }`;
3. call `storeCloudVaultRecord(record, 2)` while still on the setup screen;
4. after that succeeds, cache the metadata and an empty encrypted-item array locally; and
5. if the cloud write fails, remain on the setup screen and show `"An internet connection is required to create the vault."`.

The empty legacy `encryptedData` produced by `createVault()` remains in the envelope as a recovery-compatible value. Requiring the first cloud write prevents a locally created version-2 vault from having item rows with no parent `vaults` row.

- [ ] **Step 3: Branch unlock by storage version**

For version 1, require cloud connectivity, call the existing `unlockVault()` to get `{ key, data }`, then call `migrateLegacyVault(data, key)`. Only after it succeeds, update local metadata to version 2, assign `keyRef`, set data, and report unlocked. On failure, clear the key/data, keep version 1, and show `"Could not migrate the encrypted vault. Check your connection and try again."`.

For version 2:

1. call `unlockVaultKey()`;
2. fetch cloud encrypted items and read the local encrypted-item cache;
3. for matching item IDs, keep the row with the later ISO `updatedAt`; include IDs present on only one side;
4. upload any local row that won the comparison, then cache and decrypt the merged rows and set `syncStatus = "synced"`; or
5. on a cloud failure, decrypt the local encrypted-item cache and set `syncStatus = "offline"`.

This comparison lets an item edited while offline sync on the next online unlock. Permanent deletion is never completed offline, so a missing local row is not treated as a deletion marker. If no local item cache exists during an offline unlock, fail with a clear error instead of showing an empty vault.

- [ ] **Step 4: Replace whole-vault saves with one-row saves**

Add a private hook function:

```ts
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
```

Update `saveItem`, `moveToTrash`, and `restoreItem` to construct the next item and item array, then call `persistItem()`. Preserve the existing public signatures.

- [ ] **Step 5: Delete one item row permanently**

After deleting the item's document objects, call `deleteCloudEncryptedItem(id)`, remove it from the local encrypted-item cache, and then remove it from React state. If the cloud item deletion fails, retain the item in state and report offline so the UI does not claim permanent deletion succeeded.

Update the expired-trash cleanup on unlock to delete documents and item rows individually. Do not reseal or overwrite the legacy vault blob.

- [ ] **Step 6: Keep lock behavior memory-only**

Confirm `lock()` still clears `keyRef` and plaintext React state but leaves the encrypted metadata and item caches available for the next unlock. Keep the current ten-minute inactivity timer unchanged.

- [ ] **Step 7: Run static checks and commit**

```bash
npm run lint
npm run build
git diff --check
git add src/hooks/use-vault.ts
git commit -m "feat: persist vault items independently"
```

Expected: lint and production build pass with the existing component API unchanged.

### Task 6: Document deployment and perform manual verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Completed Tasks 1-5.
- Produces: Exact operator steps for applying and verifying the migration without deleting the recovery blob.

- [ ] **Step 1: Add the committed migration command**

Add this command after the existing migration commands:

```bash
neon psql production -- -v ON_ERROR_STOP=1 -f migrations/0003_create_vault_items.sql
```

State that the same file can be pasted into the Neon SQL console, must run before deploying the new application code, and does not decrypt or delete existing data.

- [ ] **Step 2: Add one-owner activation instructions**

Document this order:

1. Back up the `vaults.encrypted_record` value from the Neon dashboard.
2. Apply `migrations/0003_create_vault_items.sql`.
3. Deploy the application commit.
4. Sign in and unlock the vault once while online.
5. Check every visible item and its custom fields before editing anything.
6. Run the read-only verification query below.

```sql
SELECT
  v.storage_version,
  v.migrated_at,
  COUNT(vi.item_id) AS item_count
FROM vaults v
LEFT JOIN vault_items vi ON vi.user_id = v.user_id
GROUP BY v.id, v.storage_version, v.migrated_at;
```

Expected: one row with `storage_version = 2`, non-null `migrated_at`, and `item_count` equal to the number of vault items including trash. Explicitly say not to delete `encrypted_record` after this check.

- [ ] **Step 3: Run final repository verification**

```bash
npm run lint
npm run build
git diff --check
git status --short
```

Expected: lint and build pass; no whitespace errors; only intentional plan/README/code changes are present.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: add per-item vault migration steps"
```

- [ ] **Step 5: Hand off the SQL-console script**

Link `migrations/0003_create_vault_items.sql` as the exact script to paste into Neon. Warn the owner to apply it before deploying the code and to keep the legacy encrypted blob until they have manually confirmed all items and fields.
