"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Cloud,
  CloudOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
  Usb,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useVault } from "@/hooks/use-vault";
import { authClient } from "@/lib/auth/client";
import type { VaultItem } from "@/types/vault";

import { ChangePassphraseDialog } from "./change-passphrase-dialog";
import { ItemDetail } from "./item-detail";
import { ItemEditor } from "./item-editor";
import { ItemList } from "./item-list";
import { UnlockScreen } from "./unlock-screen";
import { VaultUnavailable } from "./vault-unavailable";
import { VaultFilter, VaultSidebar } from "./vault-sidebar";
import styles from "./vault.module.css";

interface VaultAppProps {
  userId: string;
}

export function VaultApp({ userId }: VaultAppProps) {
  const router = useRouter();
  const redirectToSignIn = useCallback((): void => router.push("/auth"), [router]);
  const vault = useVault(userId, redirectToSignIn);
  const [activeFilter, setActiveFilter] = useState<VaultFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorItem, setEditorItem] = useState<VaultItem | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isPassphraseDialogOpen, setIsPassphraseDialogOpen] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [securityNotice, setSecurityNotice] = useState("");

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (vault.data?.items ?? [])
      .filter((item) => activeFilter === "trash" ? Boolean(item.deletedAt) : !item.deletedAt)
      .filter((item) => (
        activeFilter === "all" || activeFilter === "trash" || item.category === activeFilter
      ))
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        const searchText = [
          item.title,
          item.notes,
          ...item.fields.flatMap((field) => [field.label, field.value]),
          ...item.documents.map((document) => document.name),
        ].join(" ").toLowerCase();
        return searchText.includes(normalizedQuery);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [activeFilter, query, vault.data?.items]);

  const effectiveSelectedId = visibleItems.some((item) => item.id === selectedId)
    ? selectedId
    : visibleItems[0]?.id ?? null;

  if (vault.status === "loading") {
    return <main className={styles.loadingPage}><ShieldCheck size={30} /><span>Opening Locker…</span></main>;
  }

  if (vault.status === "unavailable") {
    return <VaultUnavailable canRetry={vault.canRetry} onRetry={vault.retry} />;
  }

  if (vault.status === "new" || vault.status === "locked") {
    return (
      <UnlockScreen
        error={vault.error}
        isNew={vault.status === "new"}
        onSetup={vault.setup}
        onUnlock={vault.unlock}
      />
    );
  }

  const selectedItem = visibleItems.find((item) => item.id === effectiveSelectedId) ?? null;

  function openNewItem(): void {
    setEditorItem(null);
    setIsEditorOpen(true);
  }

  async function saveItem(item: VaultItem): Promise<void> {
    await vault.saveItem(item);
    setSelectedId(item.id);
    setIsEditorOpen(false);
    setShowMobileDetail(true);
  }

  async function signOut(): Promise<void> {
    if (
      vault.syncStatus !== "synced"
      && !window.confirm("Some changes have not synced yet and will be lost. Sign out anyway?")
    ) {
      return;
    }
    await vault.clearLocalData();
    await authClient.signOut();
    router.push("/auth");
  }

  async function registerPasskey(type: "platform" | "cross-platform"): Promise<void> {
    setSecurityNotice("Waiting for your authenticator…");
    const result = await authClient.passkey.addPasskey({
      name: type === "platform" ? "Personal device" : "Hardware security key",
      authenticatorAttachment: type,
    });
    setSecurityNotice(result.error
      ? result.error.message ?? "Could not add the passkey."
      : "Passkey added.");
  }

  async function changePassphrase(
    currentPassphrase: string,
    newPassphrase: string,
  ): Promise<boolean> {
    const succeeded = await vault.changePassphrase(currentPassphrase, newPassphrase);
    if (succeeded) {
      setSecurityNotice("Vault passphrase changed.");
    }
    return succeeded;
  }

  async function permanentlyDelete(id: string): Promise<void> {
    if (!window.confirm("Delete this item and its documents forever?")) {
      return;
    }
    await vault.permanentlyDelete(id);
    setShowMobileDetail(false);
  }

  return (
    <main className={styles.appShell}>
      <div className={styles.mobileTopbar}>
        <button aria-label="Open navigation" onClick={() => setSidebarOpen(true)} type="button">
          <Menu size={21} />
        </button>
        <strong>Locker</strong>
        <button aria-label="Add new item" onClick={openNewItem} type="button"><Plus size={21} /></button>
      </div>

      <div
        className={`${styles.sidebarWrap} ${sidebarOpen ? styles.sidebarOpen : ""}`}
        onClick={() => setSidebarOpen(false)}
        role="presentation"
      >
        <div onClick={(event) => event.stopPropagation()} role="presentation">
          <VaultSidebar
            activeFilter={activeFilter}
            items={vault.data?.items ?? []}
            onAdd={openNewItem}
            onFilter={(filter) => {
              setActiveFilter(filter);
              setSidebarOpen(false);
              setShowMobileDetail(false);
            }}
          />
          <div className={styles.sidebarFooter}>
            <span>
              {vault.syncStatus === "offline" ? <CloudOff size={15} /> : <Cloud size={15} />}
              {vault.syncStatus === "syncing"
                ? "Syncing encrypted data"
                : vault.syncStatus === "synced"
                  ? "Encrypted cloud sync"
                  : "Saved locally · offline"}
            </span>
            <button onClick={() => registerPasskey("platform")} type="button">
              <Fingerprint size={16} /> Add device passkey
            </button>
            <button onClick={() => registerPasskey("cross-platform")} type="button">
              <Usb size={16} /> Add security key
            </button>
            <button
              onClick={() => {
                setIsPassphraseDialogOpen(true);
                setSidebarOpen(false);
              }}
              type="button"
            >
              <KeyRound size={16} /> Change passphrase
            </button>
            {vault.unreadableItemCount ? (
              <p className={styles.securityNotice}>
                {vault.unreadableItemCount === 1
                  ? "1 item could not be decrypted and is hidden."
                  : `${vault.unreadableItemCount} items could not be decrypted and are hidden.`}
              </p>
            ) : null}
            {securityNotice ? <p className={styles.securityNotice}>{securityNotice}</p> : null}
            <button onClick={vault.lock} type="button"><LockKeyhole size={16} /> Lock vault</button>
            <button onClick={signOut} type="button"><LogOut size={16} /> Sign out</button>
          </div>
        </div>
      </div>

      <div className={`${styles.workspace} ${showMobileDetail ? styles.mobileDetailOpen : ""}`}>
        <ItemList
          items={visibleItems}
          onQueryChange={setQuery}
          onSelect={(id) => {
            setSelectedId(id);
            setShowMobileDetail(true);
          }}
          query={query}
          selectedId={effectiveSelectedId}
        />
        <ItemDetail
          item={selectedItem}
          onBack={() => setShowMobileDetail(false)}
          onDelete={async (id) => {
            await vault.moveToTrash(id);
            setShowMobileDetail(false);
          }}
          onDownload={vault.downloadDocument}
          onEdit={(item) => {
            setEditorItem(item);
            setIsEditorOpen(true);
          }}
          onPermanentDelete={permanentlyDelete}
          onRestore={async (id) => {
            await vault.restoreItem(id);
            setShowMobileDetail(false);
          }}
        />
      </div>

      {isEditorOpen ? (
        <ItemEditor
          item={editorItem}
          onAddDocument={vault.addDocument}
          onClose={() => setIsEditorOpen(false)}
          onSave={saveItem}
        />
      ) : null}

      {isPassphraseDialogOpen ? (
        <ChangePassphraseDialog
          error={vault.error}
          onChange={changePassphrase}
          onClose={() => setIsPassphraseDialogOpen(false)}
        />
      ) : null}
    </main>
  );
}
