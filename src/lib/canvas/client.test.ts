import { describe, expect, it } from "vitest";
import {
  CanvasClient,
  CanvasError,
  htmlToText,
  MAX_CANVAS_FILE_BYTES,
  normalizeCanvasUrl,
  parseNextLink,
} from "./client";

const BASE = "https://school.instructure.com";
const TOKEN = "secret-token";

type Route = (url: URL, init: RequestInit) => Response;

/** A fake fetch that routes by URL and records every request (incl. headers). */
function fakeFetch(routes: Record<string, Route | object>) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    calls.push({ url: url.toString(), auth: headers.get("authorization") });
    const key = Object.keys(routes).find(
      (k) => url.toString().startsWith(k) || (url.pathname + url.search).startsWith(k),
    );
    if (!key) return new Response("not found", { status: 404 });
    const route = routes[key];
    return typeof route === "function" ? (route as Route)(url, init) : Response.json(route);
  }) as typeof fetch;
  return { impl, calls };
}

describe("normalizeCanvasUrl", () => {
  it("accepts what students actually type", () => {
    expect(normalizeCanvasUrl("auburn.instructure.com")).toBe("https://auburn.instructure.com");
    expect(normalizeCanvasUrl("  https://auburn.instructure.com/courses/123 ")).toBe(
      "https://auburn.instructure.com",
    );
    expect(normalizeCanvasUrl("canvas.school.edu")).toBe("https://canvas.school.edu");
  });

  it("rejects http, internal hosts, IPs, and embedded credentials", () => {
    for (const bad of [
      "http://school.instructure.com",
      "localhost:3000",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://printer.local",
      "https://intranet",
      "https://user:pw@school.instructure.com",
      "",
      "ftp://school.edu",
    ]) {
      expect(() => normalizeCanvasUrl(bad), bad).toThrow(CanvasError);
    }
  });

  it("allows a local fake Canvas only when explicitly enabled (e2e tests)", () => {
    expect(normalizeCanvasUrl("http://localhost:4020", true)).toBe("http://localhost:4020");
  });
});

describe("parseNextLink", () => {
  it("finds rel=next among Canvas's Link relations", () => {
    const header =
      '<https://x.instructure.com/api/v1/courses?page=1>; rel="current",' +
      '<https://x.instructure.com/api/v1/courses?page=2>; rel="next",' +
      '<https://x.instructure.com/api/v1/courses?page=5>; rel="last"';
    expect(parseNextLink(header)).toBe("https://x.instructure.com/api/v1/courses?page=2");
    expect(parseNextLink('<https://x/a?page=1>; rel="first"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
  });
});

describe("htmlToText", () => {
  it("keeps structure as line breaks and decodes entities", () => {
    const html = `<h2>Cell Biology</h2><p>The cell is the <strong>basic</strong> unit of life.</p>
      <ul><li>Mitochondria &amp; ATP</li><li>Ribosomes</li></ul><script>alert(1)</script>
      <p>Temp &lt; 40&#176;C&nbsp;&mdash; always.</p>`;
    expect(htmlToText(html)).toBe(
      "Cell Biology\n\nThe cell is the basic unit of life.\n\n- Mitochondria & ATP\n\n- Ribosomes\n\nTemp < 40°C — always.",
    );
  });

  it("returns empty text for an empty page", () => {
    expect(htmlToText("<p> </p>")).toBe("");
  });
});

describe("CanvasClient", () => {
  it("sends the token to Canvas and follows pagination", async () => {
    const { impl, calls } = fakeFetch({
      "/api/v1/courses?enrollment_state=active&per_page=100": () =>
        Response.json([{ id: 2, name: "Zoology", course_code: "ZOO 101" }], {
          headers: { link: `<${BASE}/api/v1/courses?page=2>; rel="next"` },
        }),
      [`${BASE}/api/v1/courses?page=2`]: [
        { id: 1, name: "Biology", course_code: "BIO 101" },
        { id: 3, name: "Hidden", course_code: "X", access_restricted_by_date: true },
      ],
    });
    const courses = await new CanvasClient(BASE, TOKEN, impl).listCourses();
    expect(courses.map((c) => c.name)).toEqual(["Biology", "Zoology"]); // sorted, restricted dropped
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("never follows a pagination link to another host (would leak the token)", async () => {
    const { impl, calls } = fakeFetch({
      "/api/v1/courses?enrollment_state=active&per_page=100": () =>
        Response.json([], { headers: { link: `<https://evil.example.com/steal>; rel="next"` } }),
    });
    await expect(new CanvasClient(BASE, TOKEN, impl).listCourses()).rejects.toThrow(/off-site/);
    expect(calls.some((c) => c.url.includes("evil.example.com"))).toBe(false);
  });

  it("explains an expired/deleted token", async () => {
    const { impl } = fakeFetch({ "/api/v1/users/self": () => new Response("{}", { status: 401 }) });
    await expect(new CanvasClient(BASE, TOKEN, impl).getSelf()).rejects.toThrow(
      /expired or deleted/,
    );
  });

  it("merges module items and the files list, tolerating a hidden Files tab", async () => {
    const modules = [
      {
        name: "Week 1",
        items: [
          { type: "File", title: "Lecture 1.pdf", content_id: 11 },
          { type: "Page", title: "Reading notes", page_url: "reading-notes" },
          { type: "Assignment", title: "HW 1" },
          { type: "File", title: "Slides.pptx", content_id: 12 },
        ],
      },
    ];
    const withFilesHidden = fakeFetch({
      "/api/v1/courses/5/modules?include[]=items&per_page=100": modules,
      "/api/v1/courses/5/files": () => new Response("{}", { status: 403 }),
    });
    const materials = await new CanvasClient(BASE, TOKEN, withFilesHidden.impl).listCourseMaterials(
      5,
    );
    expect(materials).toEqual([
      expect.objectContaining({ kind: "file", ref: "11", moduleName: "Week 1", supported: true }),
      expect.objectContaining({ kind: "page", ref: "reading-notes", supported: true }),
      expect.objectContaining({ kind: "file", ref: "12", supported: false }), // pptx not yet
    ]);

    const withFiles = fakeFetch({
      "/api/v1/courses/5/modules?include[]=items&per_page=100": modules,
      "/api/v1/courses/5/files": [
        {
          id: 11,
          display_name: "Lecture 1.pdf",
          filename: "l1.pdf",
          "content-type": "application/pdf",
          size: 1000,
        },
        {
          id: 13,
          display_name: "Syllabus",
          filename: "s.pdf",
          "content-type": "application/pdf",
          size: 50,
        },
        { id: 14, display_name: "Locked exam key.pdf", filename: "k.pdf", locked_for_user: true },
      ],
    });
    const merged = await new CanvasClient(BASE, TOKEN, withFiles.impl).listCourseMaterials(5);
    expect(merged.find((m) => m.ref === "11")).toMatchObject({ moduleName: "Week 1", size: 1000 });
    expect(merged.find((m) => m.ref === "13")).toMatchObject({ supported: true, moduleName: null });
    expect(merged.find((m) => m.ref === "14")).toBeUndefined();
  });

  it("downloads a file, dropping the token on the cross-origin redirect to storage", async () => {
    const pdf = new TextEncoder().encode("%PDF-fake");
    const { impl, calls } = fakeFetch({
      "/api/v1/courses/5/files/11": {
        id: 11,
        display_name: "Lecture 1.pdf",
        filename: "l1.pdf",
        "content-type": "application/pdf",
        size: pdf.length,
        url: `${BASE}/files/11/download?download_frd=1&verifier=abc`,
      },
      [`${BASE}/files/11/download`]: () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://files.storage.example/l1.pdf?sig=x" },
        }),
      "https://files.storage.example/": () => new Response(pdf),
    });
    const file = await new CanvasClient(BASE, TOKEN, impl).downloadFile(5, "11");
    expect(new TextDecoder().decode(file.bytes)).toBe("%PDF-fake");
    const storageCall = calls.find((c) => c.url.startsWith("https://files.storage.example/"));
    expect(storageCall?.auth).toBeNull();
    const canvasCalls = calls.filter((c) => c.url.startsWith(BASE));
    expect(canvasCalls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("refuses files over the size cap, even if Canvas's size metadata is missing", async () => {
    const big = new Uint8Array(MAX_CANVAS_FILE_BYTES + 1);
    const { impl } = fakeFetch({
      "/api/v1/courses/5/files/99": {
        id: 99,
        display_name: "Huge.pdf",
        filename: "h.pdf",
        url: `${BASE}/dl/99`,
      },
      [`${BASE}/dl/99`]: () => new Response(big),
    });
    await expect(new CanvasClient(BASE, TOKEN, impl).downloadFile(5, "99")).rejects.toThrow(
      /too large/,
    );
  });
});
