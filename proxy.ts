import { auth } from "@/lib/auth/server";

export default auth.middleware({ loginUrl: "/auth" });

export const config = {
  matcher: ["/vault/:path*"],
};
