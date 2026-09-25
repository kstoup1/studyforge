"use client";

import { useState } from "react";
import Link from "next/link";
import { submitReview } from "@/actions/reviews";

interface StudyCard {
  id: string;
  question: string;
  answer: string;
}

// SM-2 grades are 0-5; these four buttons map onto a subset that's easier to reason
// about out loud than picking a precise number -- "Again" is a clear fail (< 3, so
// the SM-2 module resets repetitions), the other three are increasing degrees of
// "I got it".
const GRADE_BUTTONS: { label: string; grade: number; className: string }[] = [
  { label: "Again", grade: 0, className: "bg-red-600 hover:bg-red-700" },
  { label: "Hard", grade: 3, className: "bg-amber-600 hover:bg-amber-700" },
  { label: "Good", grade: 4, className: "bg-green-600 hover:bg-green-700" },
  { label: "Easy", grade: 5, className: "bg-blue-600 hover:bg-blue-700" },
];

export function StudySession({
  deckId,
  initialCards,
}: {
  deckId: string;
  initialCards: StudyCard[];
}) {
  const [queue, setQueue] = useState(initialCards);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];

  async function grade(value: number) {
    if (!current || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitReview({ cardId: current.id, grade: value });
      setQueue((q) => q.slice(1));
      setReviewedCount((n) => n + 1);
      setRevealed(false);
    } catch {
      // Card stays on screen with its answer revealed, so the student can just retry.
      setError("Couldn't save that answer. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!current) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center">
        <p className="font-medium">
          {reviewedCount > 0
            ? `Done — reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}.`
            : "No cards are due right now."}
        </p>
        <Link href={`/decks/${deckId}`} className="mt-3 inline-block text-sm underline">
          Back to deck
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-neutral-500">{queue.length} card(s) left in this session</p>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        aria-label={revealed ? undefined : "Reveal answer"}
        className="block min-h-48 w-full cursor-pointer rounded-lg border border-neutral-200 bg-white p-6 text-left"
      >
        <p className="text-lg">{current.question}</p>
        {revealed ? (
          <p className="mt-4 border-t border-neutral-100 pt-4 text-neutral-700">{current.answer}</p>
        ) : (
          <p className="mt-4 text-sm text-neutral-400">Click to reveal the answer</p>
        )}
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {revealed && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {GRADE_BUTTONS.map((b) => (
            <button
              key={b.grade}
              onClick={() => grade(b.grade)}
              disabled={submitting}
              className={`rounded-md px-3 py-2 text-sm text-white disabled:opacity-50 ${b.className}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
