export type VaultCategory = "identity" | "finance" | "personal" | "documents" | "other";

export interface VaultField {
  id: string;
  label: string;
  value: string;
  isSensitive: boolean;
}

export interface VaultDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  encryptionIv: string;
}

export interface VaultItem {
  id: string;
  title: string;
  category: VaultCategory;
  fields: VaultField[];
  notes: string;
  documents: VaultDocument[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface VaultData {
  items: VaultItem[];
}

export interface VaultRecord {
  version: 1;
  updatedAt: string;
  salt: string;
  wrapIv: string;
  wrappedKey: string;
  dataIv: string;
  encryptedData: string;
}

export interface VaultTemplate {
  name: string;
  category: VaultCategory;
  fields: Array<Pick<VaultField, "label" | "isSensitive">>;
}
