CREATE TABLE IF NOT EXISTS vaults (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vaults_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_vaults_updated_at ON vaults (updated_at);
