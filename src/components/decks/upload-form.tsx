"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/uploads/limits";

type Mode = "paste" | "file";
type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

interface JobResponse {
  id: string;
  status: JobStatus;
  stage: string | null;
  errorMessage: string | null;
  cardsCreated: number | null;
  deckId: string;
}

const STAGE_LABELS: Record<string, string> = {
  generating: "Generating flashcards…",
};

const POLL_INTERVAL_MS = 2000;
// Generation normally takes 10-40s (Inngest retries included, well under this). Past
// this, stop polling and say so rather than showing a spinner forever -- e.g. if the
// background worker isn't running at all.
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

/** Parses a JSON error body if there is one. Platform-level failures (Vercel's 413
 * for oversized bodies, a 502/504 page) come back as HTML, and calling res.json() on
 * those used to throw and leave the form silently stuck. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function UploadForm({ deckId }: { deckId: string }) {
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function pollJob(jobId: string) {
    stopPolling();
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stopPolling();
        setTimedOut(true);
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return; // transient -- try again next tick
        const data = (await readJson(res)) as JobResponse | null;
        if (!data) return;
        setJob(data);
        if (data.status === "COMPLETED" || data.status === "FAILED") stopPolling();
      } catch {
        // Network blip (laptop sleep, flaky wifi): keep polling until the timeout.
      }
    }, POLL_INTERVAL_MS);
  }

  function reset() {
    stopPolling();
    setJob(null);
    setTimedOut(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("deckId", deckId);
      if (mode === "paste") {
        if (!text.trim()) {
          setError("Paste some text first");
          return;
        }
        formData.set("text", text);
      } else {
        if (!file) {
          setError("Choose a PDF file first");
          return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(`That PDF is too large (max ${MAX_UPLOAD_LABEL}). Try splitting it up.`);
          return;
        }
        formData.set("file", file);
      }

      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await readJson(res);
      if (!res.ok || typeof data?.jobId !== "string") {
        const serverError = typeof data?.error === "string" ? data.error : null;
        setError(
          serverError ??
            (res.status === 413
              ? `That file is too large (max ${MAX_UPLOAD_LABEL}).`
              : `Upload failed (error ${res.status}). Please try again.`),
        );
        return;
      }
      setJob({
        id: data.jobId,
        status: "PENDING",
        stage: null,
        errorMessage: null,
        cardsCreated: null,
        deckId,
      });
      pollJob(data.jobId);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (job?.status === "COMPLETED") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="font-medium text-green-800">
          Done — {job.cardsCreated} flashcard{job.cardsCreated === 1 ? "" : "s"} created.
        </p>
        <Link href={`/decks/${deckId}`} className="mt-2 inline-block text-sm underline">
          View the deck
        </Link>
      </div>
    );
  }

  if (job?.status === "FAILED") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="font-medium text-red-800">Generation failed.</p>
        {job.errorMessage && <p className="mt-1 text-sm text-red-700">{job.errorMessage}</p>}
        <button
          onClick={reset}
          className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Try again
        </button>
      </div>
    );
  }

  if (timedOut && job && (job.status === "PENDING" || job.status === "PROCESSING")) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="font-medium text-amber-800">This is taking much longer than usual.</p>
        <p className="mt-1 text-sm text-amber-700">
          Your notes were saved. Check the deck in a few minutes — any cards generated will show up
          there.
        </p>
        <div className="mt-3 flex gap-3">
          <Link href={`/decks/${deckId}`} className="text-sm underline">
            Go to the deck
          </Link>
          <button onClick={reset} className="text-sm underline">
            Upload something else
          </button>
        </div>
      </div>
    );
  }

  if (job && (job.status === "PENDING" || job.status === "PROCESSING")) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <p className="font-medium">
          {job.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : "Extracting text…"}
        </p>
        <p className="mt-1 text-sm text-neutral-500">This usually takes 10–40 seconds.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("paste")}
          className={`rounded-md px-3 py-1.5 text-sm ${mode === "paste" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
        >
          Paste text
        </button>
        <button
          type="button"
          onClick={() => setMode("file")}
          className={`rounded-md px-3 py-1.5 text-sm ${mode === "file" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
        >
          Upload PDF
        </button>
      </div>

      {mode === "paste" ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="Paste your lecture notes here…"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      ) : (
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {submitting ? "Uploading…" : "Generate flashcards"}
      </button>
    </form>
  );
}
