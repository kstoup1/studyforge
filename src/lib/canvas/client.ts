/**
 * A small, read-only Canvas LMS REST client (https://canvas.instructure.com/doc/api/).
 * Only GET requests, and only the handful of endpoints StudyForge needs: who am I,
 * my courses, a course's modules/files/pages, and downloading a file.
 *
 * Security rules, since the token acts as the student on their whole account:
 * - The token is only ever sent to the connected Canvas origin. Pagination "next"
 *   links are only followed on that same origin, and file downloads (which redirect
 *   to Canvas's file storage on another domain) drop the Authorization header on any
 *   cross-origin hop.
 * - The base URL must be https and a public hostname (normalizeCanvasUrl), so the
 *   server can't be pointed at localhost/internal addresses with a user's request.
 * - Every request has a timeout; downloads have a size cap.
 */

const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_CANVAS_FILE_BYTES = 25 * 1024 * 1024; // server-side download, not a request body
/** Per import request: each item is downloaded + extracted within one request. */
export const MAX_ITEMS_PER_IMPORT = 10;
const MAX_PAGES = 20; // pagination safety net (x100 per page)
const MAX_REDIRECTS = 5;

export class CanvasError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode: string;
}

export interface CanvasMaterial {
  kind: "file" | "page";
  /** File id, or the page's url slug. */
  ref: string;
  title: string;
  /** e.g. "Week 3" -- the module it was found in, if any. */
  moduleName: string | null;
  contentType: string | null;
  size: number | null;
  /** Whether StudyForge can extract text from it (PDFs and pages, for now). */
  supported: boolean;
}

// ---------------------------------------------------------------- pure helpers

const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

/**
 * Turns what a student types ("auburn.instructure.com", "https://canvas.x.edu/courses")
 * into a bare origin, or throws a readable error. `allowInsecure` exists only for the
 * local fake-Canvas used in e2e tests (CANVAS_ALLOW_INSECURE_URLS=1).
 */
export function normalizeCanvasUrl(input: string, allowInsecure = false): string {
  const trimmed = input.trim();
  if (!trimmed) throw new CanvasError("Enter your school's Canvas address");
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new CanvasError("That doesn't look like a web address");
  }
  if (url.username || url.password)
    throw new CanvasError("Remove the username/password from the address");
  if (!allowInsecure) {
    if (url.protocol !== "https:")
      throw new CanvasError("The Canvas address must start with https://");
    if (
      BLOCKED_HOST.test(url.hostname) ||
      IP_LITERAL.test(url.hostname) ||
      !url.hostname.includes(".")
    ) {
      throw new CanvasError(
        "Use your school's public Canvas address, e.g. yourschool.instructure.com",
      );
    }
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CanvasError("The Canvas address must start with https://");
  }
  return url.origin;
}

/** The rel="next" URL from a Canvas Link header, if any. */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (match) return match[1];
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

/** Plain text from a Canvas page body (HTML), keeping paragraph/list structure as
 * line breaks so the chunker and the model see sensible boundaries. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote|pre|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : entity;
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isSupportedFile(contentType: string | null, title: string): boolean {
  return contentType === "application/pdf" || (!contentType && /\.pdf$/i.test(title));
}

// ---------------------------------------------------------------- client

interface RawModule {
  name: string;
  items?: { type: string; title: string; content_id?: number; page_url?: string }[];
}
interface RawFile {
  id: number;
  display_name: string;
  filename: string;
  "content-type"?: string;
  size?: number;
  url?: string;
  locked_for_user?: boolean;
}

export class CanvasClient {
  private origin: string;

  constructor(
    baseUrl: string,
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.origin = new URL(baseUrl).origin;
  }

  private async request(pathOrUrl: string): Promise<Response> {
    const url = new URL(pathOrUrl, this.origin);
    if (url.origin !== this.origin)
      throw new CanvasError("Refusing to send the Canvas token off-site");
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new CanvasError("Couldn't reach Canvas. Check the address and try again.");
    }
    if (res.status === 401) {
      throw new CanvasError(
        "Canvas rejected the access token -- it may be expired or deleted. Reconnect Canvas.",
        401,
      );
    }
    if (res.status === 403)
      throw new CanvasError("Canvas says you don't have access to that.", 403);
    if (res.status === 404) throw new CanvasError("Canvas couldn't find that.", 404);
    if (!res.ok) throw new CanvasError(`Canvas returned an error (${res.status}).`, res.status);
    return res;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.request(path);
    try {
      return (await res.json()) as T;
    } catch {
      throw new CanvasError("Canvas sent back something unexpected -- is this a Canvas address?");
    }
  }

  /** Follows Canvas's Link-header pagination (same origin only). */
  private async getAll<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const res = await this.request(next);
      const body = (await res.json()) as T[];
      if (!Array.isArray(body)) throw new CanvasError("Canvas sent back something unexpected.");
      results.push(...body);
      next = parseNextLink(res.headers.get("link"));
    }
    return results;
  }

  async getSelf(): Promise<{ id: number; name: string }> {
    const self = await this.getJson<{ id: number; name: string }>("/api/v1/users/self");
    if (typeof self?.id !== "number")
      throw new CanvasError("That doesn't look like a Canvas address.");
    return { id: self.id, name: self.name };
  }

  async listCourses(): Promise<CanvasCourse[]> {
    const raw = await this.getAll<{
      id: number;
      name?: string;
      course_code?: string;
      access_restricted_by_date?: boolean;
    }>("/api/v1/courses?enrollment_state=active&per_page=100");
    return raw
      .filter((c) => c.name && !c.access_restricted_by_date)
      .map((c) => ({ id: c.id, name: c.name!, courseCode: c.course_code ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Everything in a course StudyForge could turn into flashcards: files and pages
   * found in its modules (how most instructors organize material, and visible even
   * when the Files tab is hidden from students), plus the Files list when students
   * are allowed to see it. Either source being forbidden is fine.
   */
  async listCourseMaterials(courseId: number): Promise<CanvasMaterial[]> {
    const tolerate = async <T>(p: Promise<T[]>): Promise<T[]> => {
      try {
        return await p;
      } catch (err) {
        if (err instanceof CanvasError && (err.status === 403 || err.status === 404)) return [];
        throw err;
      }
    };
    const [modules, files] = await Promise.all([
      tolerate(
        this.getAll<RawModule>(`/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`),
      ),
      tolerate(
        this.getAll<RawFile>(
          `/api/v1/courses/${courseId}/files?per_page=100&sort=updated_at&order=desc`,
        ),
      ),
    ]);

    const byKey = new Map<string, CanvasMaterial>();
    for (const mod of modules) {
      for (const item of mod.items ?? []) {
        if (item.type === "File" && item.content_id) {
          byKey.set(`file:${item.content_id}`, {
            kind: "file",
            ref: String(item.content_id),
            title: item.title,
            moduleName: mod.name,
            contentType: null,
            size: null,
            supported: isSupportedFile(null, item.title),
          });
        } else if (item.type === "Page" && item.page_url) {
          byKey.set(`page:${item.page_url}`, {
            kind: "page",
            ref: item.page_url,
            title: item.title,
            moduleName: mod.name,
            contentType: "text/html",
            size: null,
            supported: true,
          });
        }
      }
    }
    for (const f of files) {
      if (f.locked_for_user) continue;
      const key = `file:${f.id}`;
      const contentType = f["content-type"] ?? null;
      byKey.set(key, {
        kind: "file",
        ref: String(f.id),
        title: f.display_name,
        moduleName: byKey.get(key)?.moduleName ?? null,
        contentType,
        size: f.size ?? null,
        supported: isSupportedFile(contentType, f.display_name),
      });
    }
    return [...byKey.values()];
  }

  async getPageText(courseId: number, pageUrl: string): Promise<{ title: string; text: string }> {
    const page = await this.getJson<{ title: string; body: string | null }>(
      `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`,
    );
    return { title: page.title, text: htmlToText(page.body ?? "") };
  }

  /** Downloads a course file. Returns the bytes plus Canvas's own metadata. */
  async downloadFile(
    courseId: number,
    fileId: string,
  ): Promise<{ filename: string; contentType: string | null; bytes: Uint8Array }> {
    const file = await this.getJson<RawFile>(
      `/api/v1/courses/${courseId}/files/${encodeURIComponent(fileId)}`,
    );
    if (!file.url)
      throw new CanvasError(
        "Canvas didn't provide a download link for that file (it may be locked).",
      );
    if (file.size && file.size > MAX_CANVAS_FILE_BYTES) {
      throw new CanvasError(
        `"${file.display_name}" is too large (max ${MAX_CANVAS_FILE_BYTES / 1024 / 1024}MB).`,
      );
    }

    // Follow redirects by hand so the token only accompanies same-origin hops.
    let url = new URL(file.url, this.origin);
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const sameOrigin = url.origin === this.origin;
      try {
        res = await this.fetchImpl(url, {
          headers: sameOrigin ? { Authorization: `Bearer ${this.token}` } : {},
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 3),
        });
      } catch {
        throw new CanvasError(`Couldn't download "${file.display_name}" from Canvas.`);
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      break;
    }
    if (!res || !res.ok || !res.body) {
      throw new CanvasError(`Couldn't download "${file.display_name}" from Canvas.`, res?.status);
    }

    // Read with a hard cap in case size metadata was missing or wrong.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CANVAS_FILE_BYTES) {
        await reader.cancel();
        throw new CanvasError(
          `"${file.display_name}" is too large (max ${MAX_CANVAS_FILE_BYTES / 1024 / 1024}MB).`,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return { filename: file.display_name, contentType: file["content-type"] ?? null, bytes };
  }
}
