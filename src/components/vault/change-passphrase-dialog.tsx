"use client";

import { FormEvent, useState } from "react";
import { X } from "lucide-react";

import styles from "./vault.module.css";

interface ChangePassphraseDialogProps {
  error: string;
  onChange: (currentPassphrase: string, newPassphrase: string) => Promise<boolean>;
  onClose: () => void;
}

export function ChangePassphraseDialog({ error, onChange, onClose }: ChangePassphraseDialogProps) {
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLocalError("");
    if (newPassphrase.length < 12) {
      setLocalError("Use at least 12 characters.");
      return;
    }
    if (newPassphrase !== confirmation) {
      setLocalError("The new passphrases do not match.");
      return;
    }
    if (newPassphrase === currentPassphrase) {
      setLocalError("Choose a passphrase different from the current one.");
      return;
    }
    setIsWorking(true);
    setHasSubmitted(true);
    const succeeded = await onChange(currentPassphrase, newPassphrase);
    setIsWorking(false);
    if (succeeded) {
      onClose();
    }
  }

  // The hook's error may predate this dialog, so only show it after a submit.
  const visibleError = localError || (hasSubmitted ? error : "");

  return (
    <div className={styles.editorBackdrop} role="presentation">
      <section aria-label="Change vault passphrase" className={styles.editor}>
        <header className={styles.editorHeader}>
          <div>
            <p>Vault security</p>
            <h1>Change passphrase</h1>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={21} /></button>
        </header>

        <form className={styles.editorForm} onSubmit={handleSubmit}>
          <p className={styles.mutedText}>
            Your items stay encrypted with the same vault key; only the passphrase that unlocks it
            changes. Other devices use the new passphrase once they are back online.
          </p>
          <label>
            Current passphrase
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setCurrentPassphrase(event.target.value)}
              required
              type="password"
              value={currentPassphrase}
            />
          </label>
          <label>
            New passphrase
            <input
              autoComplete="new-password"
              onChange={(event) => setNewPassphrase(event.target.value)}
              required
              type="password"
              value={newPassphrase}
            />
          </label>
          <label>
            Confirm new passphrase
            <input
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
              required
              type="password"
              value={confirmation}
            />
          </label>
          {visibleError ? <p className={styles.formError}>{visibleError}</p> : null}
          <p className={styles.unlockFootnote}>
            We cannot recover this passphrase. Keep it in a password manager.
          </p>
          <footer className={styles.editorFooter}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">Cancel</button>
            <button className={styles.primaryButton} disabled={isWorking} type="submit">
              {isWorking ? "Re-encrypting vault key…" : "Change passphrase"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
