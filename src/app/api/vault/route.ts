import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/auth/server";
import { sql } from "@/lib/database";

const vaultKeyEnvelopeSchema = z.object({
  cryptoVersion: z.literal(1),
  kdfSalt: z.string().min(1),
  wrapIv: z.string().min(1),
  wrappedKey: z.string().min(1),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await sql`
    SELECT crypto_version, kdf_salt, wrap_iv, wrapped_key
    FROM vaults
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return Response.json({
    keyEnvelope: rows[0] ? {
      cryptoVersion: rows[0].crypto_version,
      kdfSalt: rows[0].kdf_salt,
      wrapIv: rows[0].wrap_iv,
      wrappedKey: rows[0].wrapped_key,
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
  const result = vaultKeyEnvelopeSchema.safeParse(await request.json());
  if (!result.success) {
    return Response.json({ error: "Invalid vault key envelope" }, { status: 400 });
  }
  const envelope = result.data;
  // Create-only: an existing envelope holds the only wrapped copy of the vault key.
  const rows = await sql`
    INSERT INTO vaults (user_id, crypto_version, kdf_salt, wrap_iv, wrapped_key)
    VALUES (
      ${userId},
      ${envelope.cryptoVersion},
      ${envelope.kdfSalt},
      ${envelope.wrapIv},
      ${envelope.wrappedKey}
    )
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id
  `;
  if (!rows.length) {
    return Response.json({ error: "This account already has a vault" }, { status: 409 });
  }
  return Response.json({ saved: true });
}
