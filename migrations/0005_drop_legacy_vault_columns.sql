BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM vaults
    WHERE crypto_version IS NULL
      OR kdf_salt IS NULL
      OR wrap_iv IS NULL
      OR wrapped_key IS NULL
  ) THEN
    RAISE EXCEPTION 'Vault key columns are not fully populated';
  END IF;
END;
$$;

ALTER TABLE vaults
  ALTER COLUMN crypto_version SET NOT NULL,
  ALTER COLUMN kdf_salt SET NOT NULL,
  ALTER COLUMN wrap_iv SET NOT NULL,
  ALTER COLUMN wrapped_key SET NOT NULL,
  DROP COLUMN encrypted_record,
  DROP COLUMN storage_version,
  DROP COLUMN migrated_at;

COMMIT;
