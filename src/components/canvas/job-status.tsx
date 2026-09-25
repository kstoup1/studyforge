"use client";

import { useEffect, useState } from "react";

type Status = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
interface Job {
  status: Status;
  errorMessage: string | null;
  cardsCreated: number | null;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

/** Live status of one generation job, polled from GET /api/jobs/:id -- the same
 * endpoint the PDF/paste upload form uses. */
export function JobStatus({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        setTimedOut(true);
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok || cancelled) return;
        const data: Job = await res.json();
        setJob(data);
        if (data.status === "COMPLETED" || data.status === "FAILED") clearInterval(timer);
      } catch {
        // transient network error: try again next tick
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId]);

  if (job?.status === "COMPLETED") {
    return (
      <span className="text-green-700">
        {job.cardsCreated} flashcard{job.cardsCreated === 1 ? "" : "s"} created
      </span>
    );
  }
  if (job?.status === "FAILED") {
    return (
      <span className="text-red-700">Failed{job.errorMessage ? `: ${job.errorMessage}` : ""}</span>
    );
  }
  if (timedOut) {
    return <span className="text-amber-700">Still working. Check the deck later.</span>;
  }
  return <span className="text-neutral-500">Generating…</span>;
}
