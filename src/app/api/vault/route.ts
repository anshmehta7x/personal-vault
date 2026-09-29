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
  await sql`
    INSERT INTO vaults (user_id, crypto_version, kdf_salt, wrap_iv, wrapped_key)
    VALUES (
      ${userId},
      ${envelope.cryptoVersion},
      ${envelope.kdfSalt},
      ${envelope.wrapIv},
      ${envelope.wrappedKey}
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      crypto_version = EXCLUDED.crypto_version,
      kdf_salt = EXCLUDED.kdf_salt,
      wrap_iv = EXCLUDED.wrap_iv,
      wrapped_key = EXCLUDED.wrapped_key,
      updated_at = NOW()
  `;
  return Response.json({ saved: true });
}
