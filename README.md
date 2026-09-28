# Locker

A single-owner, end-to-end encrypted vault for IDs, personal records, bank details,
notes, and documents.

## Current prototype

- Self-managed Better Auth account login
- WebAuthn passkeys and physical FIDO2 security keys
- Password fallback for recovery
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

## Self-host your own vault

Every installation uses its own Neon project, storage bucket, secrets, owner account,
and domain. Nothing in the application code is tied to the original deployment.

### Prerequisites

- Node.js and npm
- A Neon account and project with Object Storage available
- The [Neon CLI](https://neon.com/docs/reference/cli-install)
- A Vercel account for production hosting

### 1. Clone and install

```bash
git clone https://github.com/anshmehta7x/personal-vault.git
cd personal-vault
npm install
```

The repository is private by default. Fork it or create your own private repository if
you want Vercel to deploy from your GitHub account.

### 2. Link your Neon project

```bash
npm install -g neon@latest
neon login
neon link --project-id YOUR_NEON_PROJECT_ID --branch production -y
neon deploy
neon env pull
```

`neon deploy` creates the private `vault` bucket declared in `neon.ts`. `neon env pull`
adds the database and private Object Storage credentials to `.env.local`.

### 3. Configure local authentication

Generate two separate secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Add these values to `.env.local` without committing the file:

```env
BETTER_AUTH_SECRET=FIRST_GENERATED_SECRET
VAULT_SETUP_KEY=SECOND_GENERATED_SECRET
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_ORIGIN=http://localhost:3000
BETTER_AUTH_RP_ID=localhost
```

`VAULT_SETUP_KEY` protects the first account registration. It is not a login password or
vault decryption key.

### 4. Create the database schema

Apply each migration once:

```bash
neon psql production -- -v ON_ERROR_STOP=1 -f migrations/0001_create_vaults.sql
neon psql production -- -v ON_ERROR_STOP=1 -f migrations/0002_better_auth.sql
```

The second migration creates the authentication and passkey tables and installs a database
trigger that prevents creation of more than one owner.

### 5. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`, create the owner using `VAULT_SETUP_KEY`, register a device
passkey or hardware security key, and create the separate vault passphrase.

## Deploy to Vercel

### 1. Pick the production domain

Use the final Vercel production domain or a custom domain before registering production
passkeys. WebAuthn credentials are bound to the RP ID, so changing domains later requires
registering new passkeys.

### 2. Add environment variables

Import your private GitHub repository into Vercel. In **Project Settings → Environment
Variables**, add the following for Production:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Pooled URL from `.env.local` or the Neon dashboard |
| `DATABASE_URL_UNPOOLED` | Direct URL from `.env.local`; useful for administrative work |
| `AWS_ACCESS_KEY_ID` | From `neon env pull` |
| `AWS_SECRET_ACCESS_KEY` | From `neon env pull` |
| `AWS_ENDPOINT_URL_S3` | From `neon env pull` |
| `AWS_REGION` | From `neon env pull` |
| `BETTER_AUTH_SECRET` | A new production-only output of `openssl rand -base64 32` |
| `VAULT_SETUP_KEY` | A separate random value used for the first owner registration |
| `BETTER_AUTH_URL` | `https://your-production-domain.example` |
| `BETTER_AUTH_ORIGIN` | The same full HTTPS URL |
| `BETTER_AUTH_RP_ID` | `your-production-domain.example` without `https://` or a path |

Never add real values to `.env.example`, Git, screenshots, or issue reports.

### 3. Deploy and claim the vault

Push to the repository's `main` branch to trigger the production deployment. Then:

1. Open the production URL.
2. Create the owner account using `VAULT_SETUP_KEY`.
3. Register a device passkey or physical FIDO2 security key.
4. Enter the vault and optionally add a second authenticator from the sidebar.
5. Remove `VAULT_SETUP_KEY` from Vercel and redeploy.

The setup key is not automatically deleted. The database still rejects a second owner,
but removing the environment variable after setup closes the registration path entirely.

## Environment reference

`.env.example` lists every required variable without values. Neon supplies the database
and Object Storage values. The deployer supplies the Better Auth secret, one-time setup
key, and production domain values.

For a new Neon project or a new production domain, repeat the setup with fresh secrets.
Do not share databases, storage credentials, setup keys, or auth secrets between separate
vault installations.

## Prototype security status

This is not ready for irreplaceable secrets yet. Recovery-kit support, stronger CSP
hardening, account recovery UX, and an external security review remain before production
use. The database enforces one owner. Passkey/hardware-key authentication and the
separate vault decryption passphrase are implemented.
