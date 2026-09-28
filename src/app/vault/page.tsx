import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { VaultApp } from "@/components/vault/vault-app";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/auth");
  }
  return <VaultApp />;
}
