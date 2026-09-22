"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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

export function UploadForm({ deckId }: { deckId: string }) {
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobResponse | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollJob(jobId: string) {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data: JobResponse = await res.json();
      setJob(data);
      if (data.status === "COMPLETED" || data.status === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
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
        formData.set("file", file);
      }

      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
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
          onClick={() => setJob(null)}
          className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Try again
        </button>
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
