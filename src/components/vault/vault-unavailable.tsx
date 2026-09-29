"use client";

import { CloudOff } from "lucide-react";

import styles from "./vault.module.css";

interface VaultUnavailableProps {
  canRetry: boolean;
  onRetry: () => void;
}

export function VaultUnavailable({ canRetry, onRetry }: VaultUnavailableProps) {
  return (
    <main className={styles.loadingPage}>
      <CloudOff size={30} />
      <span>
        {canRetry
          ? "Could not reach Locker. Check your connection and try again."
          : "Still could not reach Locker. Reload the page once you're back online."}
      </span>
      <button className={styles.primaryButton} disabled={!canRetry} onClick={onRetry} type="button">
        Try again
      </button>
    </main>
  );
}
