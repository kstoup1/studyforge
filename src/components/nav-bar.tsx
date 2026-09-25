import Link from "next/link";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";

// A Server Component reading the session directly, rather than next-auth/react's
// client-side useSession: no loading flicker, no /api/auth/session polling, and
// router.refresh() after sign-in/out is enough to update it.
export async function NavBar() {
  const session = await auth();

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          StudyForge
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {session?.user ? (
            <>
              <Link href="/dashboard" className="text-neutral-700 hover:text-neutral-900">
                Dashboard
              </Link>
              <Link href="/decks" className="text-neutral-700 hover:text-neutral-900">
                My decks
              </Link>
              <Link href="/settings/canvas" className="text-neutral-700 hover:text-neutral-900">
                Canvas
              </Link>
              <span className="text-neutral-400">{session.user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="text-neutral-700 hover:text-neutral-900">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
