import { z } from "zod";

export const vaultKeyEnvelopeSchema = z.object({
  cryptoVersion: z.literal(1),
  kdfSalt: z.string().min(1),
  wrapIv: z.string().min(1),
  wrappedKey: z.string().min(1),
}).strict();

export const passphraseChangeSchema = z.object({
  expectedWrappedKey: z.string().min(1),
  keyEnvelope: vaultKeyEnvelopeSchema,
}).strict();
