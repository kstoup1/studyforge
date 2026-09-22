import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDeck } from "@/actions/decks";
import { DeckActions } from "@/components/decks/deck-actions";

export default async function DeckPage(props: PageProps<"/decks/[deckId]">) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const { deckId } = await props.params;
  const deck = await getDeck(deckId);
  if (!deck) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{deck.title}</h1>
          {deck.description && <p className="mt-1 text-neutral-500">{deck.description}</p>}
        </div>
        <DeckActions
          deckId={deck.id}
          initialTitle={deck.title}
          initialDescription={deck.description ?? ""}
        />
      </div>

      <div className="mb-4">
        <Link
          href={`/decks/${deck.id}/upload`}
          className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          + Add notes
        </Link>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Cards ({deck.cards.length})</h2>
        {deck.cards.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No cards yet. Click &quot;Add notes&quot; above to generate some.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deck.cards.map((card) => (
              <li key={card.id} className="rounded-md border border-neutral-100 p-3 text-sm">
                <p className="font-medium">{card.question}</p>
                <p className="mt-1 text-neutral-500">{card.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
