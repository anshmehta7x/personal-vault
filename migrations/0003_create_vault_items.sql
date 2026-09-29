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
