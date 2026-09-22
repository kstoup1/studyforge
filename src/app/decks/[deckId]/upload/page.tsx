import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDeck } from "@/actions/decks";
import { UploadForm } from "@/components/decks/upload-form";

export default async function UploadPage(props: PageProps<"/decks/[deckId]/upload">) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const { deckId } = await props.params;
  const deck = await getDeck(deckId);
  if (!deck) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Add notes to &quot;{deck.title}&quot;</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Paste text or upload a PDF. Flashcards are generated in the background — this page will show
        progress.
      </p>
      <UploadForm deckId={deckId} />
    </div>
  );
}
