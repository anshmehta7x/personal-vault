# Per-item Vault Storage Migration

## Goal

Replace the single encrypted vault-data blob with one encrypted database row per vault item.
Preserve every existing item, custom field, note, document reference, timestamp, and trash state.
Keep all decryption in the browser so the server never receives the vault passphrase, plaintext
items, or the unwrapped vault key.

This installation has one owner. The owner can unlock the existing vault normally.

## Current State

The `vaults` table has one row per owner. Its `encrypted_record` JSONB value contains both:

- the Argon2id salt and AES-GCM-wrapped vault key; and
- the entire encrypted `VaultData` payload, including every item.

Document bytes are already encrypted independently and stored in object storage. Item payloads
only contain document metadata and object identifiers.

## Target Data Model

The existing `vaults` row remains the vault-key envelope and migration record. It is required to
derive and unwrap the client-side encryption key before any item can be decrypted.

Add storage-version and migration-time columns to `vaults`. Keep `encrypted_record` unchanged
during the migration so the original ciphertext remains a rollback copy.

Create `vault_items` with:

- `user_id TEXT NOT NULL`, referencing `vaults(user_id)` with cascading deletion;
- `item_id UUID NOT NULL`;
- `crypto_version SMALLINT NOT NULL`;
- `encryption_iv TEXT NOT NULL`;
- `encrypted_payload TEXT NOT NULL`;
- `created_at TIMESTAMPTZ NOT NULL`;
- `updated_at TIMESTAMPTZ NOT NULL`; and
- a composite primary key on `(user_id, item_id)`.

The committed migration file will be `migrations/0003_create_vault_items.sql`. It will be
idempotent where practical and usable either through the Neon CLI or by pasting it into the Neon
SQL console.

The encrypted item payload retains the existing `VaultItem` shape. In particular, custom fields
remain an ordered array of `{ id, label, value, isSensitive }`. Document bytes are not moved.

## Encryption

Continue using the existing randomly generated AES-256-GCM vault key. Encrypt each complete item
with a fresh 12-byte IV. Bind the ciphertext to its item ID through AES-GCM additional
authenticated data using `locker:v2:item:<item-id>` so ciphertext cannot be reassigned to another
item without decryption failing.

The existing passphrase-derived key continues to wrap the vault key. Changing the storage layout
does not require the owner to choose a new passphrase.

## API

Keep `/api/vault` for the key envelope, legacy encrypted blob, and storage version.

Add item endpoints that only accept and return ciphertext:

- `GET /api/vault/items` lists the authenticated owner's encrypted item rows.
- `PUT /api/vault/items/[id]` idempotently inserts or replaces one encrypted item.
- `DELETE /api/vault/items/[id]` permanently deletes one encrypted item row.
- `PUT /api/vault/migration` marks per-item storage active only after the client supplies the
  complete expected item-ID set and the server confirms those rows exist.

All endpoints derive `user_id` from the authenticated session. Clients cannot supply or query a
different owner ID. Payloads are validated before database writes.

## Client Migration

On unlock, the client checks the server storage version.

For legacy storage:

1. Decrypt the existing vault blob in browser memory.
2. Encrypt every item independently with a fresh IV and item-bound authenticated data.
3. Upsert each encrypted item through the item API. Upserts make retries safe.
4. Fetch all uploaded rows, decrypt them, and compare their item IDs and complete plaintext
   payloads with the in-memory legacy data.
5. Ask the migration endpoint to verify the expected IDs and atomically set storage version 2 and
   `migrated_at`.
6. Continue startup from the verified per-item data.

The migration blocks editing until it succeeds. If the browser closes or a request fails before
step 5, the vault remains on legacy storage and the next unlock safely retries the upserts. The
legacy ciphertext is not deleted or overwritten.

New empty vaults use per-item storage immediately. Once storage version 2 is active, saving an
item updates only its row. Moving an item to trash updates that row. Permanent deletion removes
its document objects and then its row.

## Local Cache and Offline Behavior

Keep the key envelope in the existing local-storage record. Cache encrypted per-item records
locally under a separate versioned key. Plaintext data and key bytes remain memory-only.

When online, the server copy is authoritative after migration. When the item API is unavailable,
an already-migrated vault may unlock from its encrypted local item cache and report offline status.
Offline writes continue to use the existing best-effort behavior and are outside this migration's
scope; this change must not silently claim an unsynced write is stored remotely.

## Failure and Rollback

No migration step deletes the legacy encrypted blob. A failed or interrupted migration leaves
storage version 1 active and is retried from the original payload.

After activation, decryption or row-count failures are shown as errors rather than silently
falling back to the now-stale legacy blob. The retained blob is an explicit recovery copy, not an
ongoing second source of truth.

The legacy blob and compatibility code may be removed only in a later migration after the owner
has confirmed the per-item vault works. That cleanup is not part of this change.

## Verification and Delivery

Per the owner's request, no automated tests will be added. Before activation, the browser will
perform mandatory data-integrity verification of item IDs and full decrypted item payloads. The
handoff will also include short manual steps to run the committed SQL migration, deploy the app,
unlock once, and confirm that `vaults.storage_version = 2` and the expected `vault_items` row count
exist before making any cleanup decision.
