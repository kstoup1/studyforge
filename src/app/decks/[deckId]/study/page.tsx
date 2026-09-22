import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDeck } from "@/actions/decks";
import { getDueCards } from "@/actions/cards";
import { StudySession } from "@/components/study/study-session";

export default async function StudyPage(props: PageProps<"/decks/[deckId]/study">) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const { deckId } = await props.params;
  const deck = await getDeck(deckId);
  if (!deck) notFound();

  const dueCards = await getDueCards(deckId);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Studying &quot;{deck.title}&quot;</h1>
      <StudySession
        deckId={deckId}
        initialCards={dueCards.map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
        }))}
      />
    </div>
  );
}
