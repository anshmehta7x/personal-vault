BEGIN;

DROP TRIGGER IF EXISTS enforce_single_vault_owner_before_insert ON "user";
DROP FUNCTION IF EXISTS enforce_single_vault_owner();

COMMIT;
