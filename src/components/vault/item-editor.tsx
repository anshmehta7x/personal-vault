"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { Eye, EyeOff, FileUp, Plus, Trash2, X } from "lucide-react";

import type {
  VaultCategory,
  VaultDocument,
  VaultField,
  VaultItem,
  VaultTemplate,
} from "@/types/vault";

import styles from "./vault.module.css";

interface ItemEditorProps {
  item: VaultItem | null;
  onAddDocument: (file: File) => Promise<VaultDocument>;
  onClose: () => void;
  onSave: (item: VaultItem) => Promise<void>;
}

const templates: VaultTemplate[] = [
  {
    name: "Aadhaar",
    category: "identity",
    fields: [
      { label: "Aadhaar number", isSensitive: true },
      { label: "Full name", isSensitive: false },
      { label: "Date of birth", isSensitive: false },
      { label: "Address", isSensitive: false },
    ],
  },
  {
    name: "PAN card",
    category: "identity",
    fields: [
      { label: "PAN", isSensitive: true },
      { label: "Name", isSensitive: false },
      { label: "Date of birth", isSensitive: false },
    ],
  },
  {
    name: "Bank account",
    category: "finance",
    fields: [
      { label: "Bank", isSensitive: false },
      { label: "Account number", isSensitive: true },
      { label: "IFSC", isSensitive: false },
      { label: "Account holder", isSensitive: false },
    ],
  },
  {
    name: "Passport",
    category: "identity",
    fields: [
      { label: "Passport number", isSensitive: true },
      { label: "Full name", isSensitive: false },
      { label: "Issue date", isSensitive: false },
      { label: "Expiry date", isSensitive: false },
    ],
  },
];

function makeField(label = "", isSensitive = false): VaultField {
  return { id: crypto.randomUUID(), label, value: "", isSensitive };
}

export function ItemEditor({ item, onAddDocument, onClose, onSave }: ItemEditorProps) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState<VaultCategory>(item?.category ?? "other");
  const [fields, setFields] = useState<VaultField[]>(item?.fields ?? [makeField()]);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [documents, setDocuments] = useState<VaultDocument[]>(item?.documents ?? []);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  function applyTemplate(template: VaultTemplate): void {
    setTitle(template.name);
    setCategory(template.category);
    setFields(template.fields.map((field) => makeField(field.label, field.isSensitive)));
  }

  function updateField(id: string, changes: Partial<VaultField>): void {
    setFields((current) => current.map((field) => (
      field.id === id ? { ...field, ...changes } : field
    )));
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }
    setError("");
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(files.map(onAddDocument));
      setDocuments((current) => [...current, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not encrypt the document.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSaving(true);
    const now = new Date().toISOString();
    await onSave({
      id: item?.id ?? crypto.randomUUID(),
      title: title.trim(),
      category,
      fields: fields.filter((field) => field.label.trim() || field.value.trim()),
      notes: notes.trim(),
      documents,
      createdAt: item?.createdAt ?? now,
      updatedAt: now,
      deletedAt: item?.deletedAt ?? null,
    });
    setIsSaving(false);
  }

  return (
    <div className={styles.editorBackdrop} role="presentation">
      <section aria-label={item ? "Edit item" : "Add item"} className={styles.editor}>
        <header className={styles.editorHeader}>
          <div>
            <p>{item ? "Update record" : "New record"}</p>
            <h1>{item ? item.title : "Add to your vault"}</h1>
          </div>
          <button aria-label="Close editor" onClick={onClose} type="button"><X size={21} /></button>
        </header>

        <form className={styles.editorForm} onSubmit={handleSubmit}>
          {!item ? (
            <div className={styles.templateSection}>
              <label>Start with a template</label>
              <div className={styles.templateGrid}>
                {templates.map((template) => (
                  <button key={template.name} onClick={() => applyTemplate(template)} type="button">
                    {template.name}
                  </button>
                ))}
                <button onClick={() => {
                  setTitle("");
                  setCategory("other");
                  setFields([makeField()]);
                }} type="button">Blank</button>
              </div>
            </div>
          ) : null}

          <div className={styles.editorBasics}>
            <label>
              Title
              <input onChange={(event) => setTitle(event.target.value)} required value={title} />
            </label>
            <label>
              Category
              <select
                onChange={(event) => setCategory(event.target.value as VaultCategory)}
                value={category}
              >
                <option value="identity">Identity</option>
                <option value="finance">Finance</option>
                <option value="personal">Personal</option>
                <option value="documents">Documents</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <div className={styles.fieldsEditor}>
            <div className={styles.editorSectionTitle}>
              <div><strong>Fields</strong><span>Add any information you need.</span></div>
              <button onClick={() => setFields((current) => [...current, makeField()])} type="button">
                <Plus size={16} /> Add field
              </button>
            </div>
            {fields.map((field) => (
              <div className={styles.fieldEditorRow} key={field.id}>
                <input
                  aria-label="Field label"
                  onChange={(event) => updateField(field.id, { label: event.target.value })}
                  placeholder="Label"
                  value={field.label}
                />
                <input
                  aria-label="Field value"
                  onChange={(event) => updateField(field.id, { value: event.target.value })}
                  placeholder="Value"
                  type={field.isSensitive ? "password" : "text"}
                  value={field.value}
                />
                <button
                  aria-label={field.isSensitive ? "Mark as visible" : "Mark as sensitive"}
                  className={field.isSensitive ? styles.sensitiveActive : ""}
                  onClick={() => updateField(field.id, { isSensitive: !field.isSensitive })}
                  type="button"
                >
                  {field.isSensitive ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
                <button
                  aria-label="Remove field"
                  onClick={() => setFields((current) => current.filter((entry) => entry.id !== field.id))}
                  type="button"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>

          <label className={styles.notesEditor}>
            Notes
            <textarea
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything else you want to keep with this record…"
              rows={5}
              value={notes}
            />
          </label>

          <div className={styles.uploadSection}>
            <div className={styles.editorSectionTitle}>
              <div><strong>Documents</strong><span>Up to 25 MB each. Encrypted before storage.</span></div>
            </div>
            <label className={styles.uploadButton}>
              <FileUp size={19} /> {isUploading ? "Encrypting…" : "Choose files"}
              <input disabled={isUploading} multiple onChange={handleFiles} type="file" />
            </label>
            {documents.map((document) => (
              <div className={styles.uploadedDocument} key={document.id}>
                <span>{document.name}</span>
                <button
                  aria-label={`Remove ${document.name}`}
                  onClick={() => setDocuments((current) => current.filter((entry) => entry.id !== document.id))}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>

          {error ? <p className={styles.formError}>{error}</p> : null}
          <footer className={styles.editorFooter}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">Cancel</button>
            <button className={styles.primaryButton} disabled={isSaving || isUploading} type="submit">
              {isSaving ? "Encrypting and saving…" : "Save item"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
