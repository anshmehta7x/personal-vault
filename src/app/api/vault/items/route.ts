import { getAuthenticatedUserId } from "@/lib/auth/server";
import { sql } from "@/lib/database";
import type { EncryptedVaultItem } from "@/types/vault";

interface VaultItemRow {
  item_id: string;
  crypto_version: 1;
  encryption_iv: string;
  encrypted_payload: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapVaultItem(row: VaultItemRow): EncryptedVaultItem {
  return {
    itemId: row.item_id,
    cryptoVersion: row.crypto_version,
    encryptionIv: row.encryption_iv,
    encryptedPayload: row.encrypted_payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function GET(request: Request): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql`
    SELECT
      item_id,
      crypto_version,
      encryption_iv,
      encrypted_payload,
      created_at,
      updated_at,
      deleted_at
    FROM vault_items
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  ` as VaultItemRow[];
  return Response.json({ items: rows.map(mapVaultItem) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
