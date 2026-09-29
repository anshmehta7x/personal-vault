import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/auth/server";
import { MAX_ENCRYPTED_DOCUMENT_BYTES } from "@/lib/document-limits";
import { storage, VAULT_BUCKET } from "@/lib/object-storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const uploadRequestSchema = z.object({
  size: z.number().int().positive().max(MAX_ENCRYPTED_DOCUMENT_BYTES),
}).strict();

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getObjectKey(request: Request, context: RouteContext): Promise<string | null> {
  const userId = await getAuthenticatedUserId(request);
  const { id } = await context.params;
  if (!userId || !ID_PATTERN.test(id)) {
    return null;
  }
  const owner = createHash("sha256").update(userId).digest("hex");
  return `users/${owner}/${id}.encrypted`;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const objectKey = await getObjectKey(request, context);
  if (!objectKey) {
    return Response.json({ error: "Unauthorized or invalid document" }, { status: 401 });
  }
  const result = uploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) {
    return Response.json({ error: "Documents must be 25 MB or smaller" }, { status: 400 });
  }
  // Signing the exact length makes storage reject any upload of a different size.
  const uploadUrl = await getSignedUrl(
    storage,
    new PutObjectCommand({
      Bucket: VAULT_BUCKET,
      Key: objectKey,
      ContentType: "application/octet-stream",
      ContentLength: result.data.size,
    }),
    { expiresIn: 300 },
  );
  return Response.json({ uploadUrl });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const objectKey = await getObjectKey(request, context);
  if (!objectKey) {
    return Response.json({ error: "Unauthorized or invalid document" }, { status: 401 });
  }
  const downloadUrl = await getSignedUrl(
    storage,
    new GetObjectCommand({ Bucket: VAULT_BUCKET, Key: objectKey }),
    { expiresIn: 300 },
  );
  return Response.json({ downloadUrl }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const objectKey = await getObjectKey(request, context);
  if (!objectKey) {
    return Response.json({ error: "Unauthorized or invalid document" }, { status: 401 });
  }
  await storage.send(new DeleteObjectCommand({ Bucket: VAULT_BUCKET, Key: objectKey }));
  return Response.json({ deleted: true });
}
