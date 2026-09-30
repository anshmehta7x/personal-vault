"use client";

import { useCallback, useMemo, useState } from "react";
import { Menu, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { useVault } from "@/hooks/use-vault";
import { authClient } from "@/lib/auth/client";
import { filterVaultItems } from "@/lib/vault-filter";
import type { VaultFilter, VaultItem } from "@/types/vault";

import { ChangePassphraseDialog } from "./change-passphrase-dialog";
import { ItemDetail } from "./item-detail";
import { ItemEditor } from "./item-editor";
import { ItemList } from "./item-list";
import { UnlockScreen } from "./unlock-screen";
import { VaultUnavailable } from "./vault-unavailable";
import { VaultSidebar } from "./vault-sidebar";
import { VaultSidebarFooter } from "./vault-sidebar-footer";
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

  const visibleItems = useMemo(
    () => filterVaultItems(vault.data?.items ?? [], activeFilter, query),
    [activeFilter, query, vault.data?.items],
  );

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
          <VaultSidebarFooter
            notice={securityNotice}
            onChangePassphrase={() => {
              setIsPassphraseDialogOpen(true);
              setSidebarOpen(false);
            }}
            onLock={vault.lock}
            onNotice={setSecurityNotice}
            onSignOut={signOut}
            syncStatus={vault.syncStatus}
            unreadableItemCount={vault.unreadableItemCount}
          />
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
