# Personal Vault Design

**Date:** 2026-09-29  
**Status:** Awaiting user review  
**Deployment:** Vercel Hobby, Neon Free, private GitHub repository

## 1. Purpose

Build a private, single-user web vault for identity records, personal information,
bank-account details, notes, and documents. It should make frequently used values easy to
find, reveal, copy, preview, and download from Windows, Linux, and iPhone without exposing
plaintext vault content to Vercel, Neon, or a database/storage breach.

Success means:

- The owner can use platform passkeys and FIDO2 hardware keys across the target devices.
- Authentication and vault decryption remain independent layers.
- Entries, filenames, metadata, notes, and documents reach the server only as ciphertext.
- Flexible entries are as convenient as a personal clipboard, with optional templates.
- A lost passphrase or all lost passkeys can be recovered only with an offline recovery kit.
- The app works within the Vercel and Neon free-tier constraints for approximately 1 GB of
  documents.

## 2. Scope

### Included

- One owner account; no public registration.
- Platform passkeys and cross-platform FIDO2 hardware security keys.
- A separate vault passphrase and offline recovery kit.
- Flexible entries with an optional title, arbitrary fields, sensitive/masked fields,
  encrypted plain-text notes, tags/categories, and attached documents.
- Optional templates for common items such as Aadhaar, PAN, bank account, passport, and
  address. A template only pre-populates editable fields; it never constrains the entry.
- Local search and filtering after the vault is unlocked.
- Explicit reveal, copy, document preview, and document download actions.
- A 25 MB maximum plaintext size per document.
- A 30-day encrypted Trash before permanent deletion.
- Responsive list-and-detail UI for desktop and separate list/detail screens on phone.

### Excluded from the first version

- Family accounts, sharing, organizations, or multi-user access.
- Browser extensions, autofill, OCR, offline mode, and native applications.
- Encrypted archive export/import or independent backup storage.
- Password, PIN, OTP, or CVV templates. Arbitrary encrypted fields and notes remain
  available, with a warning for especially risky values.
- Streaming or chunked document encryption.
- Third-party analytics, advertising, and remote UI assets.

## 3. Threat Model and Trust Boundaries

The design protects against:

- A leaked Neon database or object-storage bucket.
- A database administrator or infrastructure operator reading stored vault content.
- Stolen server credentials that expose stored data but not the owner's browser session.
- Network interception, in addition to TLS, because application data is ciphertext.
- Phishing on a lookalike domain through WebAuthn origin binding.
- Accidental overwrite, incomplete uploads, and detectable ciphertext tampering.

The first version does not fully protect against:

- Malicious JavaScript deployed to the legitimate production origin. It can capture a vault
  passphrase or decrypted data during use. The owner explicitly accepts this residual risk.
- A compromised, unlocked endpoint, browser extension, operating system, or clipboard.
- Data loss caused by deletion of the Neon account/project beyond Neon's recovery window.
- Compromise of every registered passkey plus the offline recovery kit.

The vault passphrase and recovery key must never be sent to Vercel or Neon. Plaintext vault
content exists only in the browser while the vault is unlocked.

## 4. Architecture

### Components

- **Next.js/TypeScript application on Vercel:** responsive UI, authenticated API routes,
  authorization checks, presigned object-storage operations, and security headers.
- **Neon Auth:** identity and secure server sessions if it passes the authentication gate in
  Section 5.
- **Neon Postgres:** authentication records plus application-owned encrypted envelopes,
  record state, revisions, and random object references.
- **Private Neon Object Storage bucket named `vault`:** encrypted document objects only.
- **Browser cryptography module:** key derivation, key wrapping, entry/document encryption,
  decryption, local indexing, and automatic locking.

The Neon project is `hidden-snow-02741687`, using the `production` branch. Infrastructure is
declared in `neon.ts`. The production branch must be protected before real data is added.

### Storage boundaries

Postgres may know random identifiers, ownership, ciphertext sizes, record states, revisions,
and timestamps. It must not receive plaintext titles, field names, values, notes, tags,
filenames, MIME types, or document contents. Object keys are random and reveal no filename.

Object Storage contains complete encrypted document blobs. Documents are not stored in
Postgres because Neon Free database storage is smaller and binary data would increase
database bloat and restore cost.

## 5. Authentication and Account Recovery

### Authentication acceptance gate

Before implementing the vault, provision Neon Auth in a non-production branch and verify all
of the following with real devices:

1. The application can register and use multiple platform and cross-platform WebAuthn
   credentials.
2. Windows, Linux, and iPhone can authenticate successfully.
3. FIDO2 hardware keys work with user verification required.
4. Credentials can be listed, named, and revoked individually.
5. Public signup can be disabled after the one-time owner bootstrap.
6. Email alone cannot reset or bypass passkey authentication.
7. Account recovery can be gated by a high-entropy recovery token.

If Neon Auth fails any item, the implementation uses self-hosted Better Auth with its official
passkey plugin on Vercel, backed by Neon Postgres. This is the approved fallback and is not a
reason to weaken any acceptance criterion.

### Owner bootstrap

- A one-time, high-entropy bootstrap token creates the only account.
- Setup requires registering at least one platform passkey and two hardware security keys.
- The bootstrap route and token are permanently disabled after completion.
- Adding or removing credentials requires a recent WebAuthn authentication ceremony.

### Recovery kit

The printable recovery kit contains two independent, randomly generated 256-bit secrets:

- An account recovery token. Only a slow or keyed verifier is retained server-side.
- A vault recovery key that wraps the vault key and is never sent to the server.

Recovery registers a new passkey and re-wraps the existing vault key under a new passphrase.
Email possession by itself is insufficient. Losing all passkeys and the recovery kit causes
permanent loss of access.

## 6. Cryptographic Design

### Key hierarchy

1. The browser generates a random 256-bit vault key.
2. The vault passphrase is processed with Argon2id using a unique random salt and versioned
   parameters. Parameters must meet current OWASP minimums and be calibrated to an acceptable
   unlock time on the target iPhone.
3. The derived key encrypts the vault key with AES-256-GCM.
4. The independent recovery key encrypts the same vault key in a second envelope.
5. Each entry and document receives its own random 256-bit data-encryption key.
6. Each data key is wrapped by the vault key; its payload is encrypted with AES-256-GCM.

Every AES-GCM operation uses a fresh random 96-bit nonce. Authenticated additional data binds
the ciphertext to its crypto-format version, vault ID, object ID, payload type, and record
revision so ciphertext cannot be silently moved between records. Cryptographic formats,
Argon2id parameters, and wrapping algorithms are explicitly versioned.

Use native Web Crypto for AES-GCM, HKDF, and secure randomness. Use a maintained,
browser-compatible Argon2id implementation rather than custom cryptographic code. Key bytes
and decrypted payloads are retained only as long as needed and are not persisted in local or
session storage.

### Locking

- Successful authentication does not unlock the vault.
- The vault passphrase is required after page load or reload.
- The in-memory vault key is cleared after 10 minutes without vault interaction, on logout,
  on explicit lock, and when the page is closed.
- Sensitive routes and responses use `Cache-Control: no-store`.

## 7. Data Model

The application schema uses UUID identifiers and contains these conceptual entities:

- **vaults:** owner reference, encrypted vault-key envelopes, KDF salt and versioned
  parameters, crypto version, and timestamps.
- **items:** vault reference, encrypted item payload, wrapped data key, nonces, crypto version,
  revision, encrypted/deleted state, and timestamps.
- **documents:** item reference, random object key, encrypted metadata, wrapped data key,
  ciphertext size/hash, upload state, deletion state, and timestamps.
- **account_recovery_credentials:** account reference, recovery-token verifier, creation time,
  use time, and revocation time.
- **security_events:** non-sensitive event type, outcome, credential reference where safe,
  and timestamp. No IP-derived location history is required for the first version.

An item payload contains its title, category/tags, ordered field definitions and values,
sensitivity flags, and plain-text notes. "Plain-text notes" describes the editor format; the
entire payload is encrypted before transmission. Rich HTML/Markdown is intentionally excluded
to reduce script-injection and rendering risk.

## 8. Main Data Flows

### Create or edit an entry

1. Require an authenticated session and an unlocked in-memory vault.
2. Build the flexible item payload in the browser.
3. Generate or reuse the item's data key, encrypt the new payload, and increment its revision.
4. Send only the encrypted envelope and state to an authenticated API route.
5. Perform an optimistic revision check. A stale edit is rejected and both versions are kept
   available to the user for manual resolution.

Failed saves preserve the in-browser draft and visibly report that synchronization failed.

### Upload a document

1. Reject plaintext files larger than 25 MB before reading them.
2. Generate a document key and encrypt the complete file in browser memory.
3. Create a pending document row and request a short-lived, single-object upload grant.
4. Upload the encrypted blob directly to the private Neon bucket.
5. Mark the document ready only after object size/hash verification succeeds.

Expired pending rows and orphaned objects are cleaned up. No server function receives the
plaintext file.

### Preview or download a document

1. An authenticated API verifies ownership and returns a short-lived download grant.
2. The browser downloads ciphertext, validates and decrypts it locally.
3. Preview uses a temporary in-memory Blob URL that is revoked when closed.
4. Download creates a local plaintext file only after successful authenticated decryption.

### Delete and restore

Deletion sets an encrypted Trash state and a server-visible deletion timestamp. Items and
their document objects remain recoverable for 30 days, then a cleanup job permanently deletes
the database rows and objects. Restore within that period clears the deletion state.

## 9. User Experience

### Desktop

- Left sidebar: All items, Identity, Finance, Documents, Archive/Trash, and Settings.
- Middle pane: local search, filter controls, add button, and item list.
- Detail pane: masked fields, explicit reveal/copy actions, notes, attachments, and edit/lock
  actions.

### Phone

- List and detail are separate screens rather than compressed panes.
- Copy, reveal, download, add-field, and lock actions remain reachable without horizontal
  scrolling.

### Entry editor

- One-page editor.
- Optional template picker followed by fully editable fields.
- Users can add, rename, reorder, change type, mark sensitive, or remove any field.
- Notes and multiple documents are optional.
- Templates never make fields mandatory unless technically required for the entry itself.

Sensitive values are masked by default. Clipboard clearing is attempted after 30 seconds but
is presented as best-effort because browsers and operating systems do not guarantee it. The UI
warns against storing PINs, OTPs, banking passwords, or CVVs but does not inspect or block
arbitrary encrypted fields or notes.

## 10. Error Handling and Integrity

- Wrong passphrases produce a generic unlock failure and never corrupt key envelopes.
- Authentication, authorization, validation, and rate-limit failures are distinct but do not
  reveal whether unrelated records exist.
- AES-GCM authentication failure stops processing; partial plaintext is never rendered.
- Storage or database outages leave the current local draft intact.
- Upload progress differentiates encryption, transfer, and finalization failures.
- Duplicate or conflicting saves use optimistic revisions rather than last-write-wins.
- Permanent deletion is idempotent so retries cannot leave inconsistent database/object state.

## 11. Security Controls

- Strict Content Security Policy without third-party scripts, inline executable script, remote
  fonts, or uncontrolled connection origins.
- HSTS, `X-Content-Type-Options: nosniff`, restrictive `Referrer-Policy` and
  `Permissions-Policy`, frame denial, and same-origin request enforcement.
- Secure, HTTP-only, same-site session cookies and CSRF protection for state-changing routes.
- Rate limits on authentication, recovery, upload-grant, and destructive endpoints.
- Server-side ownership checks on every record and object operation; object-storage credentials
  never reach the browser.
- Redacted structured logging. Logs and errors never include field values, notes, filenames,
  decrypted payloads, passphrases, recovery secrets, or encryption keys.
- No service worker or HTTP cache stores authenticated vault responses.
- GitHub, Vercel, and Neon administrator accounts require strong MFA/passkeys.
- Production deploys originate only from the protected main branch after CI passes.
- Dependency lockfiles, automated vulnerability alerts, and deliberate dependency updates.

The private repository protects source visibility but is not treated as a cryptographic
control. No application secret, Neon credential, recovery value, or local `.env` file is
committed.

## 12. Backups and Data-Loss Policy

The first version has no application-level export, import, or independent backup. Recovery
depends on the encrypted 30-day Trash and Neon's platform recovery capabilities. The recovery
kit restores access to surviving ciphertext but cannot recreate deleted Neon data. This
limitation is accepted for the first version and must be visible in Settings.

## 13. Verification

### Automated tests

- Cryptographic test vectors and round trips for every format version.
- Wrong-passphrase, wrong-key, modified-ciphertext, modified-AAD, and nonce-handling tests.
- Recovery re-wrap tests proving that neither the server verifier nor one recovery secret can
  reveal the other secret or the vault key.
- Entry CRUD, optimistic conflicts, Trash retention, and permanent-deletion tests.
- Document encryption/upload/download round trips at small, typical, and 25 MB boundary sizes.
- Interrupted upload and orphan-cleanup tests.
- Authorization tests proving that unauthenticated or incorrectly scoped requests fail.
- Tests ensuring seeded plaintext markers never appear in database rows, object keys, server
  logs, API payloads after encryption, or generated error messages.
- Content Security Policy and security-header checks.
- Responsive UI and accessibility tests for keyboard navigation, focus, labels, and contrast.

### Manual acceptance tests

- Register, authenticate, name, and revoke credentials on Windows, Linux, and iPhone.
- Authenticate with both a platform passkey and each of two hardware security keys.
- Complete the account and vault recovery flow from a clean browser profile.
- Confirm email alone cannot recover or enter the account.
- Verify auto-lock, explicit lock, clipboard warning, and tab/reload behavior.
- Preview and download representative PDF and image documents on desktop and iPhone.
- Inspect Neon Postgres, Object Storage, Vercel logs, and browser network traffic for plaintext
  test markers before any real personal data is entered.

## 14. Deployment and Rollout

1. Create a private GitHub repository from this local project.
2. Provision a separate Neon development/preview branch with synthetic data.
3. Run the Neon Auth acceptance gate and select Neon Auth or the approved Better Auth fallback.
4. Implement and test cryptography before building data-entry features.
5. Connect Vercel preview deployments only to isolated Neon branches.
6. Protect the production branch and configure least-privilege production credentials.
7. Deploy production, complete one-time owner bootstrap, and remove the bootstrap secret.
8. Complete the full manual security checklist with synthetic markers.
9. Add real personal information only after all checks pass.

## 15. Final Acceptance Criteria

- Only the bootstrapped owner can obtain an authenticated session.
- Multiple platform/hardware passkeys work across all target platforms.
- Authentication never unlocks the vault without the vault passphrase.
- Database, object storage, API logs, and network inspection reveal no plaintext vault content.
- Recovery works with the recovery kit and fails without it.
- Flexible entries, local search, reveal/copy, and document upload/preview/download work on
  desktop and iPhone.
- Documents up to 25 MB round-trip without corruption.
- Vault locking, conflict handling, incomplete-upload cleanup, Trash, and permanent deletion
  behave as specified.
- CI and the manual security checklist pass before real data is stored.
