import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { auth } from "@/lib/auth/server";
import { storage, VAULT_BUCKET } from "@/lib/object-storage";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getObjectKey(context: RouteContext): Promise<string | null> {
  const { data: session } = await auth.getSession();
  const { id } = await context.params;
  if (!session?.user.id || !ID_PATTERN.test(id)) {
    return null;
  }
  const owner = createHash("sha256").update(session.user.id).digest("hex");
  return `users/${owner}/${id}.encrypted`;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const objectKey = await getObjectKey(context);
  if (!objectKey) {
    return Response.json({ error: "Unauthorized or invalid document" }, { status: 401 });
  }
  const uploadUrl = await getSignedUrl(
    storage,
    new PutObjectCommand({
      Bucket: VAULT_BUCKET,
      Key: objectKey,
      ContentType: "application/octet-stream",
    }),
    { expiresIn: 300 },
  );
  return Response.json({ uploadUrl });
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const objectKey = await getObjectKey(context);
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

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const objectKey = await getObjectKey(context);
  if (!objectKey) {
    return Response.json({ error: "Unauthorized or invalid document" }, { status: 401 });
  }
  await storage.send(new DeleteObjectCommand({ Bucket: VAULT_BUCKET, Key: objectKey }));
  return Response.json({ deleted: true });
}
