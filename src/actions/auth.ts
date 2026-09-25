"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const registerSchema = z.object({
  // Stored lowercased: emails are case-insensitive in practice, and without this
  // "Foo@x.com" and "foo@x.com" could become two separate accounts.
  email: z.string().trim().toLowerCase().email(),
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

  return { ok: true };
}
