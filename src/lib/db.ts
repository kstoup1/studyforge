import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 requires an explicit driver adapter (no more implicit url-from-schema
// connection). A single PrismaClient instance is reused across hot reloads in dev
// so `next dev` doesn't exhaust Postgres connections on every file save.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Optional cap on the pg pool size. Local `npx prisma dev` runs PGlite, which only
// supports ONE connection at a time: with the default pool, concurrent requests
// interleave on its socket and fail with "bind message supplies N parameters, but
// prepared statement requires 0" (08P01) -- seen live as random 500s and failed
// sign-ins. .env sets DATABASE_POOL_MAX=1 for that; leave it unset for real Postgres.
function poolMax(): number | undefined {
  const value = Number(process.env.DATABASE_POOL_MAX);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: poolMax() });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
