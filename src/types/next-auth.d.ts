import type { DefaultSession } from "next-auth";

// Auth.js's default Session["user"] has no `id` -- augment it so
// `session.user.id` (set in the session callback in src/lib/auth.ts) type-checks.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
