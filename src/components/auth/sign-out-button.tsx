"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOutUser } from "@/actions/auth";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await signOutUser();
      router.push("/");
      router.refresh(); // re-render the server-side nav bar without the session
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
