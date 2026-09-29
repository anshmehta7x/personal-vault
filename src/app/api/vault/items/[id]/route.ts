import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/auth/server";
import { sql } from "@/lib/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const idSchema = z.string().uuid();
const encryptedItemSchema = z.object({
  itemId: z.string().uuid(),
  cryptoVersion: z.literal(1),
  encryptionIv: z.string().min(1),
  encryptedPayload: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
}).strict();

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  const parsedItem = encryptedItemSchema.safeParse(await request.json());
  if (!parsedId.success || !parsedItem.success || parsedItem.data.itemId !== parsedId.data) {
    return Response.json({ error: "Invalid encrypted vault item" }, { status: 400 });
  }
  const item = parsedItem.data;
  await sql`
    INSERT INTO vault_items (
      user_id,
      item_id,
      crypto_version,
      encryption_iv,
      encrypted_payload,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ${userId},
      ${item.itemId},
      ${item.cryptoVersion},
      ${item.encryptionIv},
      ${item.encryptedPayload},
      ${item.createdAt},
      ${item.updatedAt},
      ${item.deletedAt}
    )
    ON CONFLICT (user_id, item_id)
    DO UPDATE SET
      crypto_version = EXCLUDED.crypto_version,
      encryption_iv = EXCLUDED.encryption_iv,
      encrypted_payload = EXCLUDED.encrypted_payload,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      deleted_at = EXCLUDED.deleted_at
  `;
  return Response.json({ saved: true });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const result = idSchema.safeParse(id);
  if (!result.success) {
    return Response.json({ error: "Invalid vault item ID" }, { status: 400 });
  }
  await sql`
    DELETE FROM vault_items
    WHERE user_id = ${userId} AND item_id = ${result.data}
  `;
  return Response.json({ deleted: true });
}
