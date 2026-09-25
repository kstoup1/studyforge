"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  importFromCanvas,
  listCanvasCourses,
  listCanvasMaterials,
  type ImportItemResult,
} from "@/actions/canvas";
import { MAX_ITEMS_PER_IMPORT, type CanvasCourse, type CanvasMaterial } from "@/lib/canvas/client";
import { JobStatus } from "@/components/canvas/job-status";

const keyOf = (m: CanvasMaterial) => `${m.kind}:${m.ref}`;
const OTHER_FILES = "Other files";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

export function CanvasImporter({ deckId }: { deckId: string }) {
  const [courses, setCourses] = useState<CanvasCourse[] | null>(null);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [materials, setMaterials] = useState<CanvasMaterial[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportItemResult[] | null>(null);

  useEffect(() => {
    listCanvasCourses()
      .then((r) => (r.ok ? setCourses(r.data) : setError(r.error)))
      .catch(() => setError("Couldn't reach the server. Refresh to try again."));
  }, []);

  async function chooseCourse(id: number) {
    setCourseId(id);
    setMaterials(null);
    setSelected(new Set());
    setError(null);
    setLoading(true);
    try {
      const r = await listCanvasMaterials(id);
      if (r.ok) setMaterials(r.data);
      else setError(r.error);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(m: CanvasMaterial) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyOf(m))) next.delete(keyOf(m));
      else if (next.size < MAX_ITEMS_PER_IMPORT) next.add(keyOf(m));
      return next;
    });
  }

  async function handleImport() {
    if (!materials || courseId === null) return;
    setImporting(true);
    setError(null);
    try {
      const items = materials
        .filter((m) => selected.has(keyOf(m)))
        .map((m) => ({ kind: m.kind, ref: m.ref, title: m.title }));
      const r = await importFromCanvas({ deckId, courseId, items });
      if (r.ok) setResults(r.data);
      else setError(r.error);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setImporting(false);
    }
  }

  // Group by module in Canvas's own order; files not in any module go last.
  const groups = useMemo(() => {
    const map = new Map<string, CanvasMaterial[]>();
    for (const m of materials ?? []) {
      const name = m.moduleName ?? OTHER_FILES;
      map.set(name, [...(map.get(name) ?? []), m]);
    }
    const other = map.get(OTHER_FILES);
    map.delete(OTHER_FILES);
    if (other) map.set(OTHER_FILES, other);
    return [...map.entries()];
  }, [materials]);

  if (results) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 font-medium">
          Importing {results.length} item{results.length === 1 ? "" : "s"}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {results.map((r, i) => (
            <li
              key={i}
              className="flex flex-wrap justify-between gap-2 border-b border-neutral-100 pb-2"
            >
              <span className="font-medium">{r.title}</span>
              {r.ok ? (
                <JobStatus jobId={r.jobId} />
              ) : (
                <span className="text-red-700">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-4 text-sm">
          <Link href={`/decks/${deckId}`} className="underline">
            View the deck
          </Link>
          <button
            onClick={() => {
              setResults(null);
              setSelected(new Set());
            }}
            className="underline"
          >
            Import more
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {courses === null && !error && (
        <p className="text-sm text-neutral-500">Loading your courses…</p>
      )}
      {courses && courses.length === 0 && (
        <p className="text-sm text-neutral-500">No active courses found in Canvas.</p>
      )}
      {courses && courses.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          Course
          <select
            value={courseId ?? ""}
            onChange={(e) => chooseCourse(Number(e.target.value))}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2"
          >
            <option value="" disabled>
              Choose a course…
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {loading && <p className="text-sm text-neutral-500">Loading course materials…</p>}
      {materials && materials.length === 0 && (
        <p className="text-sm text-neutral-500">
          This course has no files or pages you can access in Canvas.
        </p>
      )}

      {groups.map(([moduleName, items]) => (
        <fieldset key={moduleName} className="rounded-lg border border-neutral-200 bg-white p-4">
          <legend className="px-1 text-sm font-medium">{moduleName}</legend>
          <ul className="flex flex-col gap-1.5">
            {items.map((m) => (
              <li key={keyOf(m)}>
                <label
                  className={`flex items-center gap-2 text-sm ${m.supported ? "" : "text-neutral-400"}`}
                >
                  <input
                    type="checkbox"
                    disabled={!m.supported}
                    checked={selected.has(keyOf(m))}
                    onChange={() => toggle(m)}
                  />
                  <span>{m.title}</span>
                  <span className="text-xs text-neutral-400">
                    {m.kind === "page" ? "Page" : formatSize(m.size)}
                    {!m.supported && " · only PDFs and pages are supported"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}

      {materials && materials.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {importing ? "Importing from Canvas…" : `Import ${selected.size} selected`}
          </button>
          <span className="text-xs text-neutral-500">Up to {MAX_ITEMS_PER_IMPORT} at a time</span>
        </div>
      )}
    </div>
  );
}
