"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().min(1).max(100).optional(),
});

export type RegisterResult = { ok: true } | { ok: false; error: string };

/**
 * Creates a new user with a bcrypt-hashed password. Auth.js's Credentials provider
 * (src/lib/auth.ts) only handles *signing in* an existing user -- it has no concept
 * of registration, so this is hand-rolled. Doesn't sign the user in itself; the
 * sign-in form calls next-auth's `signIn("credentials", ...)` separately after this
 * succeeds.
 */
export async function registerUser(input: unknown): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: "An account with that email already exists" };
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, hashedPassword, name },
  });

  return { ok: true };
}
