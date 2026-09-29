# Locker

Locker is a client-encrypted vault for structured records, notes, and documents. The server stores
account data, key-wrapping parameters, ciphertext, IVs, timestamps, and encrypted files; vault
plaintext and the unwrapped vault key remain in browser memory.

## Zero-knowledge architecture

Locker uses a zero-knowledge storage architecture: encryption and decryption happen in the
browser, while the backend stores only key-wrapping material and ciphertext. This describes the
storage trust boundary; it is not a zero-knowledge proof protocol.

- Next.js 16 and React 19
- Better Auth with passwords, WebAuthn passkeys, and FIDO2 security keys
- Neon Postgres for authentication, key envelopes, and encrypted item rows
- Private Neon Object Storage for encrypted documents
- Web Crypto AES-256-GCM and Argon2id through `hash-wasm`

Each account has an independent vault and vault passphrase. Items are stored as separate encrypted
rows, so updating one item does not rewrite the complete vault. Document bytes are encrypted before
upload and stored separately from item metadata.

### Data model

`vaults` stores one key envelope per user:

- `crypto_version`
- `kdf_salt`
- `wrap_iv`
- `wrapped_key`

`vault_items` stores independently encrypted items keyed by `(user_id, item_id)`. The encrypted
payload contains the title, category, ordered custom fields, sensitivity flags, notes, document
metadata, and trash state.

Object-storage keys are scoped to a SHA-256 hash of the authenticated user ID. The database and
object-storage APIs derive ownership from the server session rather than accepting a user ID from
the client.

## Cryptography and key lifecycle

1. The browser derives a 256-bit key from the vault passphrase with Argon2id using a random
   128-bit salt, 64 MiB of memory, three iterations, and one lane.
2. The browser generates a random AES-256-GCM vault key.
3. The passphrase-derived key encrypts the vault key. Only this wrapped key and its parameters are
   stored by the server.
4. Each vault item is encrypted with the vault key, a fresh 96-bit IV, and item-ID-bound additional
   authenticated data.
5. Documents are encrypted with the vault key and a fresh 96-bit IV before upload.

The unwrapped vault key is held only in memory. Locker clears it on explicit lock, sign-out, page
closure, or after ten minutes without interaction. Encrypted item and document caches support
limited offline access.

## Security properties and limitations

- The database and object store do not contain the vault passphrase, plaintext vault key, item
  plaintext, or document plaintext.
- AES-GCM authenticates encrypted content and rejects modified or reassigned item ciphertext.
- Account authentication and vault decryption use separate credentials.
- Sensitive-field masking is a UI feature; every item field is encrypted regardless of its flag.
- Losing the vault passphrase currently means losing access to the vault. There is no recovery key.
- The server still controls the JavaScript delivered to the browser. A compromised deployment
  could capture plaintext during use, so this is not protection against a malicious application
  release or compromised client device.
- Authentication metadata, row timestamps, ciphertext sizes, and access patterns are not hidden.
- The project has not undergone an independent security audit.

## Screenshots

**Login:**
<img width="3191" height="1546" alt="Screenshot From 2026-09-29 13-55-28" src="https://github.com/user-attachments/assets/3277a8ff-e297-43e3-93d1-068bdac4f5e6" />


**Desktop vault overview:**
<img width="2000" height="968" alt="Screenshot From 2026-09-29 13-49-47" src="https://github.com/user-attachments/assets/66272148-6ddb-446d-aff4-7351ae57c7f9" />

**Item Creation:** 
<img width="2000" height="968" alt="Screenshot From 2026-09-29 13-54-00" src="https://github.com/user-attachments/assets/d68f7d67-b780-4991-a220-bba38771b7b6" />

## Hosted-site onboarding

Account creation requires the deployment's setup key. To request access, contact
[@anshmehta7x](https://github.com/anshmehta7x).

1. Open the hosted Locker deployment and select **Create account**.
2. Enter your email, account password, and the provided setup key.
3. Optionally register a device passkey or physical FIDO2 security key.
4. Create a separate vault passphrase and store it in a password manager.

The setup key authorizes account creation only; it cannot decrypt a vault. It is reusable while
enabled, so the operator should remove or rotate it after an onboarding window.

## Self-hosting

### Requirements

- Node.js and npm
- A Neon project with Object Storage
- Neon CLI
- Vercel or another Next.js-compatible host

### Install

```bash
git clone https://github.com/anshmehta7x/personal-vault.git
cd personal-vault
npm install
npm install -g neon@latest
neon login
neon link --project-id YOUR_NEON_PROJECT_ID --branch production -y
neon deploy
neon env pull
```

`neon deploy` creates the private bucket declared in `neon.ts`. Apply the SQL migrations in
numeric order:

```bash
for migration in migrations/*.sql; do
  neon psql production -- -v ON_ERROR_STOP=1 -f "$migration"
done
```

Generate independent authentication and setup secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Configure `.env.local` for local development and the same variables in the production host:

```env
DATABASE_URL=
DATABASE_URL_UNPOOLED=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT_URL_S3=
AWS_REGION=
BETTER_AUTH_SECRET=
VAULT_SETUP_KEY=
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_ORIGIN=http://localhost:3000
BETTER_AUTH_RP_ID=localhost
```

Never reuse secrets between development and production or commit their values.

Run locally:

```bash
npm run dev
```

### Registration

While `VAULT_SETUP_KEY` is configured, anyone who knows it can register. Remove the variable and
redeploy to close registration. Re-add or rotate it for a later onboarding window.

### Production deployment

Set `BETTER_AUTH_URL` and `BETTER_AUTH_ORIGIN` to the final HTTPS origin. Set
`BETTER_AUTH_RP_ID` to its hostname without a scheme or path. WebAuthn credentials are bound to
that RP ID, so choose the production domain before registering passkeys.

Push the repository to the production host, create the initial account, register a passkey, and
then remove `VAULT_SETUP_KEY` unless registration should remain open.
