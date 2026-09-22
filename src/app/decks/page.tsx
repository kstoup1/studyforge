import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { listDecks } from "@/actions/decks";
import { CreateDeckForm } from "@/components/decks/create-deck-form";

export default async function DecksPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const decks = await listDecks();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Your decks</h1>

      <CreateDeckForm />

      {decks.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">
          No decks yet — create one above to get started.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link
                href={`/decks/${deck.id}`}
                className="block rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-400"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{deck.title}</span>
                  <span className="text-sm text-neutral-500">{deck._count.cards} cards</span>
                </div>
                {deck.description && (
                  <p className="mt-1 text-sm text-neutral-500">{deck.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
