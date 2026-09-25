// Invoked from e2e/*.spec.ts afterAll hooks via child_process -- see create-cards.ts
// for why this runs through tsx rather than being imported into the spec file.
//   npx tsx scripts/e2e/delete-user.ts <email>
import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: delete-user.ts <email>");
  await prisma.user.deleteMany({ where: { email } }); // cascades to decks/cards
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
