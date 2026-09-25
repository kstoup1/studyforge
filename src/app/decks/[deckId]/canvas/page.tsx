import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDeck } from "@/actions/decks";
import { getCanvasStatus } from "@/actions/canvas";
import { CanvasImporter } from "@/components/canvas/canvas-importer";

export default async function CanvasImportPage(props: PageProps<"/decks/[deckId]/canvas">) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const { deckId } = await props.params;
  const deck = await getDeck(deckId);
  if (!deck) notFound();
  const status = await getCanvasStatus();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Import into &quot;{deck.title}&quot;</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Pick lecture PDFs and course pages from Canvas. Each one becomes its own set of flashcards
        in this deck.
      </p>
      {status.connected ? (
        <CanvasImporter deckId={deckId} />
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <p className="font-medium">Canvas isn&apos;t connected yet.</p>
          <Link href="/settings/canvas" className="mt-2 inline-block text-sm underline">
            Connect Canvas
          </Link>
        </div>
      )}
    </div>
  );
}
