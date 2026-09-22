"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renameDeck, deleteDeck } from "@/actions/decks";

type Mode = "view" | "editing" | "confirming-delete";

export function DeckActions({
  deckId,
  initialTitle,
  initialDescription,
}: {
  deckId: string;
  initialTitle: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);

  async function handleRename() {
    setBusy(true);
    try {
      await renameDeck(deckId, { title, description: description || undefined });
      setMode("view");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteDeck(deckId);
      router.push("/decks");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "editing") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={handleRename}
            disabled={busy}
            className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => setMode("view")} className="rounded-md px-3 py-1 text-sm">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "confirming-delete") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-800">
          Delete &quot;{initialTitle}&quot;? This can&apos;t be undone.
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Yes, delete it"}
          </button>
          <button
            onClick={() => setMode("view")}
            disabled={busy}
            className="rounded-md px-3 py-1 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => setMode("editing")}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
      >
        Rename
      </button>
      <button
        onClick={() => setMode("confirming-delete")}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    </div>
  );
}
