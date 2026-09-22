// One-off smoke test: confirms the Prisma client + driver adapter can actually
// connect and round-trip a query against the local dev database. Not part of the
// app; run manually with `npx tsx scripts/db-smoke-test.ts` after `prisma migrate dev`.
//
// Unlike `next dev` (which loads .env automatically) or the Prisma CLI (which loads
// it via prisma7.config.ts's `import "dotenv/config"`), a script run directly through
// tsx sees no env vars unless it loads them itself.
import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const user = await prisma.user.create({
    data: { email: `smoke-test-${Date.now()}@example.com`, name: "Smoke Test" },
  });
  console.log("Created user:", user);

  const found = await prisma.user.findUnique({ where: { id: user.id } });
  console.log("Round-tripped user:", found);

  await prisma.user.delete({ where: { id: user.id } });
  console.log("Cleaned up. Smoke test passed.");
}

main()
  .catch((e) => {
    console.error("Smoke test FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
