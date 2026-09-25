"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectCanvas } from "@/actions/canvas";

export function DisconnectCanvasButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await disconnectCanvas();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
    >
      {busy ? "Disconnecting…" : "Disconnect Canvas"}
    </button>
  );
}
