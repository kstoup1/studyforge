import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCanvasStatus } from "@/actions/canvas";
import { ConnectCanvasForm } from "@/components/canvas/connect-canvas-form";
import { DisconnectCanvasButton } from "@/components/canvas/disconnect-canvas-button";

export default async function CanvasSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const status = await getCanvasStatus();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Canvas</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Connect your school&apos;s Canvas to turn lecture PDFs and course pages into flashcards
        without downloading anything. StudyForge only ever <strong>reads</strong> from Canvas.
      </p>

      {status.connected ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-medium text-green-800">
            Connected{status.canvasUserName ? ` as ${status.canvasUserName}` : ""}
          </p>
          <p className="mt-1 text-sm text-green-700">{status.baseUrl}</p>
          <p className="mt-3 text-sm text-neutral-700">
            Open any deck and choose <strong>Import from Canvas</strong>.{" "}
            <Link href="/decks" className="underline">
              Go to my decks
            </Link>
          </p>
          <div className="mt-4 flex items-center gap-3">
            <DisconnectCanvasButton />
          </div>
          <details className="mt-4 text-sm text-neutral-600">
            <summary className="cursor-pointer">Use a new access token</summary>
            <div className="mt-3">
              <ConnectCanvasForm defaultBaseUrl={status.baseUrl ?? ""} />
            </div>
          </details>
        </div>
      ) : (
        <ConnectCanvasForm defaultBaseUrl="" />
      )}
    </div>
  );
}
