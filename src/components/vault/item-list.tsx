"use client";

import { BadgeIndianRupee, FileText, Fingerprint, Search, UserRound } from "lucide-react";

import type { VaultCategory, VaultItem } from "@/types/vault";

import styles from "./vault.module.css";

interface ItemListProps {
  items: VaultItem[];
  query: string;
  selectedId: string | null;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
}

const categoryIcons: Record<VaultCategory, typeof Fingerprint> = {
  identity: Fingerprint,
  finance: BadgeIndianRupee,
  personal: UserRound,
  documents: FileText,
  other: FileText,
};

export function ItemList({
  items,
  query,
  selectedId,
  onQueryChange,
  onSelect,
}: ItemListProps) {
  return (
    <section className={styles.listPane}>
      <label className={styles.searchBox}>
        <Search size={17} />
        <input
          aria-label="Search vault"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search your vault"
          type="search"
          value={query}
        />
      </label>
      <div className={styles.listHeading}>
        <span>{items.length} {items.length === 1 ? "item" : "items"}</span>
        <span>Updated</span>
      </div>
      <div className={styles.itemList}>
        {items.map((item) => {
          const Icon = categoryIcons[item.category];
          const preview = item.fields.find((field) => !field.isSensitive && field.value)?.value
            || item.category;
          return (
            <button
              className={selectedId === item.id ? styles.itemActive : ""}
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span className={styles.itemIcon}><Icon size={19} /></span>
              <span className={styles.itemText}>
                <strong>{item.title}</strong>
                <small>{preview}</small>
              </span>
              <time>{new Date(item.updatedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}</time>
            </button>
          );
        })}
        {items.length === 0 ? (
          <div className={styles.emptyList}>
            <Fingerprint size={26} />
            <strong>Nothing here yet</strong>
            <span>Add a record or try another search.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
