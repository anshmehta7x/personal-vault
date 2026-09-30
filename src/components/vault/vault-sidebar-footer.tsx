"use client";

import {
  Cloud,
  CloudOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  LogOut,
  Usb,
} from "lucide-react";

import { authClient } from "@/lib/auth/client";

import styles from "./vault.module.css";

interface VaultSidebarFooterProps {
  notice: string;
  onChangePassphrase: () => void;
  onLock: () => void;
  onNotice: (notice: string) => void;
  onSignOut: () => void;
  syncStatus: "syncing" | "synced" | "offline";
  unreadableItemCount: number;
}

export function VaultSidebarFooter({
  notice,
  onChangePassphrase,
  onLock,
  onNotice,
  onSignOut,
  syncStatus,
  unreadableItemCount,
}: VaultSidebarFooterProps) {
  async function registerPasskey(type: "platform" | "cross-platform"): Promise<void> {
    onNotice("Waiting for your authenticator…");
    const result = await authClient.passkey.addPasskey({
      name: type === "platform" ? "Personal device" : "Hardware security key",
      authenticatorAttachment: type,
    });
    onNotice(result.error
      ? result.error.message ?? "Could not add the passkey."
      : "Passkey added.");
  }

  return (
    <div className={styles.sidebarFooter}>
      <span>
        {syncStatus === "offline" ? <CloudOff size={15} /> : <Cloud size={15} />}
        {syncStatus === "syncing"
          ? "Syncing encrypted data"
          : syncStatus === "synced"
            ? "Encrypted cloud sync"
            : "Saved locally · offline"}
      </span>
      <button onClick={() => registerPasskey("platform")} type="button">
        <Fingerprint size={16} /> Add device passkey
      </button>
      <button onClick={() => registerPasskey("cross-platform")} type="button">
        <Usb size={16} /> Add security key
      </button>
      <button onClick={onChangePassphrase} type="button">
        <KeyRound size={16} /> Change passphrase
      </button>
      {unreadableItemCount ? (
        <p className={styles.securityNotice}>
          {unreadableItemCount === 1
            ? "1 item could not be decrypted and is hidden."
            : `${unreadableItemCount} items could not be decrypted and are hidden.`}
        </p>
      ) : null}
      {notice ? <p className={styles.securityNotice}>{notice}</p> : null}
      <button onClick={onLock} type="button"><LockKeyhole size={16} /> Lock vault</button>
      <button onClick={onSignOut} type="button"><LogOut size={16} /> Sign out</button>
    </div>
  );
}
