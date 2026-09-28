import { S3Client } from "@aws-sdk/client-s3";

export const VAULT_BUCKET = "vault";

export const storage = new S3Client({
  forcePathStyle: true,
});
