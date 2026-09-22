import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getDashboardData } from "@/actions/dashboard";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const { dueToday, streak, decks } = await getDashboardData();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>

      <div className="mb-8 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <p className="text-sm text-neutral-500">Due today</p>
          <p className="mt-1 text-3xl font-semibold">{dueToday}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <p className="text-sm text-neutral-500">Study streak</p>
          <p className="mt-1 text-3xl font-semibold">
            {streak} {streak === 1 ? "day" : "days"}
          </p>
        </div>
      </div>

      <h2 className="mb-3 font-medium">Decks</h2>
      {decks.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No decks yet.{" "}
          <Link href="/decks" className="underline">
            Create one
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link
                href={`/decks/${deck.id}`}
                className="block rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-400"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{deck.title}</span>
                  <span className="text-sm text-neutral-500">{deck.cardCount} cards</span>
                </div>
                <div className="mt-2">
                  <div className="h-1.5 w-full rounded-full bg-neutral-100">
                    <div
                      className="h-1.5 rounded-full bg-green-500"
                      style={{ width: `${deck.masteryPercent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{deck.masteryPercent}% mastered</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
