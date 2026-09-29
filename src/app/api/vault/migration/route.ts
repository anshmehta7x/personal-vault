import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/auth/server";
import { sql } from "@/lib/database";

const migrationSchema = z.object({
  expectedItemIds: z.array(z.string().uuid()).refine(
    (ids) => new Set(ids).size === ids.length,
    "Item IDs must be unique",
  ),
}).strict();

export async function PUT(request: Request): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = migrationSchema.safeParse(await request.json());
  if (!result.success) {
    return Response.json({ error: "Invalid migration payload" }, { status: 400 });
  }
  const expectedItemIds = JSON.stringify(result.data.expectedItemIds);
  const rows = await sql`
    WITH expected AS (
      SELECT value::uuid AS item_id
      FROM jsonb_array_elements_text(${expectedItemIds}::jsonb)
    ),
    actual AS (
      SELECT item_id
      FROM vault_items
      WHERE user_id = ${userId}
    ),
    validation AS (
      SELECT
        NOT EXISTS (
          SELECT item_id FROM expected
          EXCEPT
          SELECT item_id FROM actual
        )
        AND NOT EXISTS (
          SELECT item_id FROM actual
          EXCEPT
          SELECT item_id FROM expected
        ) AS is_match
    )
    UPDATE vaults
    SET
      storage_version = 2,
      migrated_at = COALESCE(migrated_at, NOW()),
      updated_at = NOW()
    FROM validation
    WHERE user_id = ${userId} AND validation.is_match
    RETURNING migrated_at
  `;
  if (!rows.length) {
    return Response.json({ error: "Vault item set does not match" }, { status: 409 });
  }
  return Response.json({ migrated: true, migratedAt: rows[0].migrated_at });
}
