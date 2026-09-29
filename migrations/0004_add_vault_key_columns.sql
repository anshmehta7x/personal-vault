BEGIN;

ALTER TABLE vaults
  ADD COLUMN IF NOT EXISTS crypto_version SMALLINT CHECK (crypto_version = 1),
  ADD COLUMN IF NOT EXISTS kdf_salt TEXT,
  ADD COLUMN IF NOT EXISTS wrap_iv TEXT,
  ADD COLUMN IF NOT EXISTS wrapped_key TEXT;

UPDATE vaults
SET
  crypto_version = (encrypted_record->>'version')::SMALLINT,
  kdf_salt = encrypted_record->>'salt',
  wrap_iv = encrypted_record->>'wrapIv',
  wrapped_key = encrypted_record->>'wrappedKey'
WHERE crypto_version IS NULL
  OR kdf_salt IS NULL
  OR wrap_iv IS NULL
  OR wrapped_key IS NULL;

ALTER TABLE vaults
  ALTER COLUMN encrypted_record DROP NOT NULL;

COMMIT;
