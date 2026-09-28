import { z } from "zod";

import { auth } from "@/lib/auth/server";
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

async function getUserId(): Promise<string | null> {
  const { data: session } = await auth.getSession();
  return session?.user.id ?? null;
}

export async function GET(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql`
    SELECT encrypted_record
    FROM vaults
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return Response.json({ record: rows[0]?.encrypted_record ?? null }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = vaultRecordSchema.safeParse(await request.json());
  if (!result.success) {
    return Response.json({ error: "Invalid encrypted vault payload" }, { status: 400 });
  }
  const encryptedRecord = JSON.stringify(result.data);
  await sql`
    INSERT INTO vaults (user_id, encrypted_record)
    VALUES (${userId}, ${encryptedRecord}::jsonb)
    ON CONFLICT (user_id)
    DO UPDATE SET
      encrypted_record = EXCLUDED.encrypted_record,
      updated_at = NOW()
  `;
  return Response.json({ saved: true });
}
