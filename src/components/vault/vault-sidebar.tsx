"use client";

import {
  Archive,
  BadgeIndianRupee,
  FileText,
  Fingerprint,
  LayoutGrid,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";

import type { VaultCategory, VaultItem } from "@/types/vault";

import styles from "./vault.module.css";

export type VaultFilter = "all" | VaultCategory | "trash";

interface VaultSidebarProps {
  activeFilter: VaultFilter;
  items: VaultItem[];
  onAdd: () => void;
  onFilter: (filter: VaultFilter) => void;
}

const filters: Array<{
  id: VaultFilter;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { id: "all", label: "All items", icon: LayoutGrid },
  { id: "identity", label: "Identity", icon: Fingerprint },
  { id: "finance", label: "Finance", icon: BadgeIndianRupee },
  { id: "personal", label: "Personal", icon: UserRound },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "other", label: "Other", icon: Archive },
];

export function VaultSidebar({ activeFilter, items, onAdd, onFilter }: VaultSidebarProps) {
  const activeItems = items.filter((item) => !item.deletedAt);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarBrand}>
        <span className={styles.brandMark}><Fingerprint size={21} /></span>
        <span>Locker</span>
      </div>
      <button className={styles.addButton} onClick={onAdd} type="button">
        <Plus size={18} /> Add new
      </button>
      <nav className={styles.nav} aria-label="Vault categories">
        <p>Vault</p>
        {filters.map(({ id, label, icon: Icon }) => {
          const count = id === "all"
            ? activeItems.length
            : activeItems.filter((item) => item.category === id).length;
          return (
            <button
              className={activeFilter === id ? styles.navActive : ""}
              key={id}
              onClick={() => onFilter(id)}
              type="button"
            >
              <Icon size={17} />
              <span>{label}</span>
              <small>{count}</small>
            </button>
          );
        })}
      </nav>
      <button
        className={`${styles.trashButton} ${activeFilter === "trash" ? styles.navActive : ""}`}
        onClick={() => onFilter("trash")}
        type="button"
      >
        <Trash2 size={17} />
        <span>Recently deleted</span>
        <small>{items.filter((item) => item.deletedAt).length}</small>
      </button>
    </aside>
  );
}
