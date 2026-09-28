# Locker

A single-owner, end-to-end encrypted vault for IDs, personal records, bank details,
notes, and documents.

## Current prototype

- Neon Auth account login
- Separate vault passphrase using Argon2id
- AES-256-GCM encryption in the browser
- Flexible records with templates, custom sensitive fields, and notes
- Private encrypted document uploads up to 25 MB
- Neon Postgres encrypted-state sync and private Neon Object Storage
- Mask, reveal, copy, best-effort clipboard clearing, and 10-minute auto-lock
- Responsive desktop and phone UI
- 30-day trash retention

The server stores ciphertext, salts, IVs, timestamps, and encrypted files. The vault
passphrase and decrypted data stay in browser memory. An encrypted local cache supports
fast reopening and limited offline use.

## Run locally

```bash
npm install
neon link --project-id hidden-snow-02741687 --branch production -y
neon env pull
npm run dev
```

Add `NEON_AUTH_COOKIE_SECRET` to `.env.local` using a 32+ character random secret:

```bash
openssl rand -base64 32
```

Apply the database migration once:

```bash
neon psql production -- -v ON_ERROR_STOP=1 -f migrations/0001_create_vaults.sql
```

## Deploy to Vercel

Import the private GitHub repository into Vercel and copy the variables listed in
`.env.example` into the Vercel project. Use a new production-only
`NEON_AUTH_COOKIE_SECRET`; do not copy it into source control.

## Prototype security status

This is not ready for irreplaceable secrets yet. Passkey/hardware-key login, recovery
kit support, single-owner signup closure, stronger CSP hardening, and an external
security review remain before production use. Managed Neon Auth currently provides the
account login; the separate vault passphrase is already required for decryption.
