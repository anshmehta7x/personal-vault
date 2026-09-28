"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Clipboard,
  Download,
  Eye,
  EyeOff,
  File,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import type { VaultDocument, VaultItem } from "@/types/vault";

import styles from "./vault.module.css";

interface ItemDetailProps {
  item: VaultItem | null;
  onBack: () => void;
  onDelete: (id: string) => Promise<void>;
  onDownload: (document: VaultDocument) => Promise<void>;
  onEdit: (item: VaultItem) => void;
  onPermanentDelete: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ItemDetail({
  item,
  onBack,
  onDelete,
  onDownload,
  onEdit,
  onPermanentDelete,
  onRestore,
}: ItemDetailProps) {
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");

  async function copyValue(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    setNotice("Copied. Clipboard will be cleared in 30 seconds.");
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === value) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Clipboard read permission is browser-controlled.
      }
    }, 30_000);
    window.setTimeout(() => setNotice(""), 3_000);
  }

  if (!item) {
    return (
      <section className={styles.detailPane}>
        <div className={styles.emptyDetail}>
          <span><ShieldCheck size={30} /></span>
          <h2>Your vault is ready</h2>
          <p>Select an item or add your first record.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.detailPane}>
      <div className={styles.detailHeader}>
        <button className={styles.mobileBack} onClick={onBack} type="button">
          <ArrowLeft size={19} /> Back
        </button>
        <div>
          <p>{item.category}</p>
          <h1>{item.title}</h1>
          <span>Updated {new Date(item.updatedAt).toLocaleString()}</span>
        </div>
        <div className={styles.detailActions}>
          {item.deletedAt ? (
            <>
              <button onClick={() => onRestore(item.id)} type="button"><RotateCcw size={17} /> Restore</button>
              <button className={styles.dangerButton} onClick={() => onPermanentDelete(item.id)} type="button">
                <Trash2 size={17} /> Delete forever
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(item)} type="button"><Pencil size={17} /> Edit</button>
              <button onClick={() => onDelete(item.id)} type="button"><Trash2 size={17} /> Trash</button>
            </>
          )}
        </div>
      </div>

      {notice ? <div className={styles.toast}>{notice}</div> : null}

      <div className={styles.detailContent}>
        <section className={styles.fieldCard}>
          <div className={styles.sectionTitle}>
            <h2>Details</h2>
            <span>{item.fields.length} fields</span>
          </div>
          {item.fields.length ? item.fields.map((field) => {
            const isRevealed = !field.isSensitive || revealedFields.has(field.id);
            return (
              <div className={styles.fieldRow} key={field.id}>
                <div>
                  <span>{field.label || "Untitled field"}</span>
                  <strong className={!isRevealed ? styles.masked : ""}>
                    {isRevealed ? field.value || "—" : "••••••••••••"}
                  </strong>
                </div>
                <div className={styles.fieldActions}>
                  {field.isSensitive ? (
                    <button
                      aria-label={isRevealed ? "Hide value" : "Reveal value"}
                      onClick={() => setRevealedFields((current) => {
                        const next = new Set(current);
                        if (next.has(field.id)) {
                          next.delete(field.id);
                        } else {
                          next.add(field.id);
                        }
                        return next;
                      })}
                      type="button"
                    >
                      {isRevealed ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  ) : null}
                  <button aria-label="Copy value" onClick={() => copyValue(field.value)} type="button">
                    <Clipboard size={17} />
                  </button>
                </div>
              </div>
            );
          }) : <p className={styles.emptySection}>No fields added.</p>}
        </section>

        {item.notes ? (
          <section className={styles.notesCard}>
            <div className={styles.sectionTitle}><h2>Notes</h2></div>
            <p>{item.notes}</p>
          </section>
        ) : null}

        <section className={styles.documentsCard}>
          <div className={styles.sectionTitle}>
            <h2>Documents</h2>
            <span>{item.documents.length}</span>
          </div>
          {item.documents.length ? item.documents.map((document) => (
            <div className={styles.documentRow} key={document.id}>
              <span className={styles.documentIcon}><File size={20} /></span>
              <div>
                <strong>{document.name}</strong>
                <span>{formatBytes(document.size)} · Encrypted</span>
              </div>
              <button aria-label={`Download ${document.name}`} onClick={() => onDownload(document)} type="button">
                <Download size={18} />
              </button>
            </div>
          )) : <p className={styles.emptySection}>No documents attached.</p>}
        </section>
      </div>
    </section>
  );
}
