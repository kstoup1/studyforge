import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">StudyForge</h1>
      <p className="mt-4 max-w-xl text-lg text-neutral-600">
        Turn your lecture notes into flashcards, automatically. Study them with a spaced-repetition
        scheduler that knows what you actually need to review.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/sign-up"
          className="rounded-md bg-neutral-900 px-5 py-2.5 text-white hover:bg-neutral-700"
        >
          Get started
        </Link>
        <Link
          href="/sign-in"
          className="rounded-md border border-neutral-300 px-5 py-2.5 hover:bg-neutral-100"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
