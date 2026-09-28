import { passkey } from "@better-auth/passkey";
import { attachDatabasePool } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { createHash, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

const defaultBaseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";
const baseUrl = process.env.BETTER_AUTH_URL ?? defaultBaseUrl;
const origin = process.env.BETTER_AUTH_ORIGIN ?? new URL(baseUrl).origin;
const rpId = process.env.BETTER_AUTH_RP_ID ?? new URL(origin).hostname;

const globalDatabase = globalThis as typeof globalThis & { lockerAuthPool?: Pool };
const pool = globalDatabase.lockerAuthPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 20_000,
});

if (process.env.NODE_ENV !== "production") {
  globalDatabase.lockerAuthPool = pool;
}
attachDatabasePool(pool);

function isValidSetupKey(providedKey: string | null): boolean {
  const expectedKey = process.env.VAULT_SETUP_KEY;
  if (!providedKey || !expectedKey) {
    return false;
  }
  const providedHash = createHash("sha256").update(providedKey).digest();
  const expectedHash = createHash("sha256").update(expectedKey).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export const auth = betterAuth({
  appName: "Locker",
  baseURL: baseUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    autoSignIn: true,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (_user, context) => {
          return isValidSetupKey(context?.request?.headers.get("x-vault-setup-key") ?? null);
        },
      },
    },
  },
  trustedOrigins: [origin],
  plugins: [
    passkey({
      rpID: rpId,
      rpName: "Locker",
      origin,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    }),
    nextCookies(),
  ],
});

export async function getAuthenticatedUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}
