import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/auth/server";
import { sql } from "@/lib/database";

const vaultRecordSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  salt: z.string().min(1),
  wrapIv: z.string().min(1),
  wrappedKey: z.string().min(1),
  dataIv: z.string().min(1),
  encryptedData: z.string().min(1),
});

const vaultWriteSchema = z.object({
  record: vaultRecordSchema,
  storageVersion: z.union([z.literal(1), z.literal(2)]),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql`
    SELECT encrypted_record, storage_version, migrated_at
    FROM vaults
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return Response.json({
    metadata: rows[0] ? {
      record: rows[0].encrypted_record,
      storageVersion: rows[0].storage_version,
      migratedAt: rows[0].migrated_at,
    } : null,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = vaultWriteSchema.safeParse(await request.json());
  if (!result.success) {
    return Response.json({ error: "Invalid encrypted vault payload" }, { status: 400 });
  }
  const encryptedRecord = JSON.stringify(result.data.record);
  await sql`
    INSERT INTO vaults (user_id, encrypted_record, storage_version, migrated_at)
    VALUES (
      ${userId},
      ${encryptedRecord}::jsonb,
      ${result.data.storageVersion},
      CASE WHEN ${result.data.storageVersion} = 2 THEN NOW() ELSE NULL END
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      encrypted_record = EXCLUDED.encrypted_record,
      updated_at = NOW()
  `;
  return Response.json({ saved: true });
}
