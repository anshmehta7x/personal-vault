"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import styles from "./vault.module.css";

interface UnlockScreenProps {
  error: string;
  isNew: boolean;
  onSetup: (passphrase: string) => Promise<boolean>;
  onUnlock: (passphrase: string) => Promise<boolean>;
}

export function UnlockScreen({ error, isNew, onSetup, onUnlock }: UnlockScreenProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLocalError("");
    if (isNew && passphrase !== confirmation) {
      setLocalError("The passphrases do not match.");
      return;
    }
    if (passphrase.length < 12) {
      setLocalError("Use at least 12 characters.");
      return;
    }
    setIsWorking(true);
    const succeeded = isNew ? await onSetup(passphrase) : await onUnlock(passphrase);
    setIsWorking(false);
    if (succeeded) {
      setPassphrase("");
      setConfirmation("");
    }
  }

  return (
    <main className={styles.unlockPage}>
      <div className={styles.unlockBrand}>
        <span className={styles.brandMark}><ShieldCheck size={22} /></span>
        <span>Locker</span>
      </div>
      <section className={styles.unlockCard}>
        <div className={styles.unlockIcon}><LockKeyhole size={28} /></div>
        <p className={styles.eyebrow}>{isNew ? "One last layer" : "Vault locked"}</p>
        <h1>{isNew ? "Create your vault passphrase" : "Unlock your vault"}</h1>
        <p className={styles.mutedText}>
          {isNew
            ? "This passphrase encrypts your information on this device. It is separate from your account login."
            : "Your encrypted information is ready when you are."}
        </p>
        <form className={styles.unlockForm} onSubmit={handleSubmit}>
          <label>
            Vault passphrase
            <span className={styles.passwordInput}>
              <KeyRound size={17} />
              <input
                autoFocus
                autoComplete={isNew ? "new-password" : "current-password"}
                onChange={(event) => setPassphrase(event.target.value)}
                required
                type="password"
                value={passphrase}
              />
            </span>
          </label>
          {isNew ? (
            <label>
              Confirm passphrase
              <span className={styles.passwordInput}>
                <KeyRound size={17} />
                <input
                  autoComplete="new-password"
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  type="password"
                  value={confirmation}
                />
              </span>
            </label>
          ) : null}
          {localError || error ? <p className={styles.formError}>{localError || error}</p> : null}
          <button className={styles.primaryButton} disabled={isWorking} type="submit">
            {isWorking ? "Deriving encryption key…" : isNew ? "Create encrypted vault" : "Unlock"}
          </button>
        </form>
        <p className={styles.unlockFootnote}>
          We cannot recover this passphrase. Keep it in a password manager.
        </p>
      </section>
    </main>
  );
}
