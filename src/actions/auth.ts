"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { signIn, signOut } from "@/lib/auth";

// Sign-in/out run here, server-side, rather than via next-auth/react's client
// helpers. The client flow fetches a CSRF token and then POSTs it -- but Auth.js
// mints a *new* CSRF cookie on any auth request that arrives without one, so a slow
// /api/auth/session request still in flight (the old client SessionProvider's first
// fetch, e.g. on a cold start) could land afterwards and overwrite the cookie, failing sign-in with
// MissingCSRF. Seen live in e2e runs right after a server restart. Server Actions
// are CSRF-protected by Next.js itself (Origin check), and Auth.js's server-side
// signIn/signOut skip its token check and set cookies directly -- no race possible.

const registerSchema = z.object({
  // Stored lowercased: emails are case-insensitive in practice, and without this
  // "Foo@x.com" and "foo@x.com" could become two separate accounts.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().min(1).max(100).optional(),
});

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Creates a new user with a bcrypt-hashed password, then signs them in. Auth.js's
 * Credentials provider (src/lib/auth.ts) only handles *signing in* an existing user
 * -- it has no concept of registration, so this part is hand-rolled.
 */
export async function registerUser(input: unknown): Promise<AuthResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, password, name } = parsed.data;

  const alreadyExists = { ok: false, error: "An account with that email already exists" } as const;

  // Case-insensitive so accounts created before emails were normalized still match.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (existing) return alreadyExists;

  const hashedPassword = await bcrypt.hash(password, 12);
  try {
    await prisma.user.create({
      data: { email, hashedPassword, name },
    });
  } catch (err) {
    // Two sign-ups for the same email racing past the check above: the unique
    // constraint catches the loser, which gets the same friendly error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return alreadyExists;
    }
    throw err;
  }

  const signedIn = await signInWithPassword({ email, password });
  return signedIn.ok
    ? signedIn
    : { ok: false, error: "Account created, but sign-in failed. Try signing in manually." };
}

export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  try {
    await signIn("credentials", { ...input, redirect: false });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: "Incorrect email or password" };
    throw err;
  }
}

export async function signOutUser(): Promise<void> {
  await signOut({ redirect: false });
}

/** Redirects (via a thrown Next.js redirect) to Google's consent screen. */
export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/decks" });
}
