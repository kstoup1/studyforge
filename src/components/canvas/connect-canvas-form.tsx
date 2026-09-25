"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectCanvas } from "@/actions/canvas";

export function ConnectCanvasForm({ defaultBaseUrl }: { defaultBaseUrl: string }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Where the student generates a token, once they've typed their school's address.
  const settingsLink = (() => {
    try {
      const url = new URL(/^[a-z]+:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
      return url.hostname.includes(".") ? `${url.origin}/profile/settings` : null;
    } catch {
      return null;
    }
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await connectCanvas({ baseUrl, token });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setToken("");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5"
    >
      <label className="flex flex-col gap-1 text-sm">
        Your school&apos;s Canvas address
        <input
          type="text"
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="yourschool.instructure.com"
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600">
        <li>
          Open{" "}
          {settingsLink ? (
            <a href={settingsLink} target="_blank" rel="noreferrer" className="underline">
              your Canvas settings
            </a>
          ) : (
            "your Canvas settings (Account → Settings)"
          )}
          .
        </li>
        <li>
          Under <strong>Approved Integrations</strong>, click <strong>+ New Access Token</strong>.
        </li>
        <li>Purpose: &quot;StudyForge&quot;. Pick an expiry date if you like, then generate it.</li>
        <li>Copy the token and paste it below. Canvas only shows it once.</li>
      </ol>

      <label className="flex flex-col gap-1 text-sm">
        Access token
        <input
          type="password"
          required
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 font-mono"
        />
      </label>
      <p className="text-xs text-neutral-500">
        Stored encrypted and used only to read your courses. Delete it anytime in Canvas, or
        disconnect here.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {submitting ? "Checking with Canvas…" : "Connect Canvas"}
      </button>
    </form>
  );
}
