// A fake Canvas LMS for end-to-end tests of the Canvas import, so they never touch a
// real school's Canvas or a real student's token. Mirrors the real API shapes the app
// uses (src/lib/canvas/client.ts), including the awkward parts:
//   - courses are paginated via a Link header
//   - the Files tab is hidden from students (403), so files are only reachable
//     through modules
//   - file downloads 302-redirect to a *different origin* (Canvas's file storage),
//     which must NOT receive the student's token -- the storage server records the
//     Authorization header of every request so tests can assert that.
//
//   node scripts/e2e/mock-canvas.mjs   # Canvas on :4020, file storage on :4021
//
// Test hook: GET http://localhost:4020/__requests -> [{ server, path, auth }]
import http from "node:http";

const CANVAS_PORT = 4020;
const STORAGE_PORT = 4021;
export const VALID_TOKEN = "fake-canvas-token-for-e2e-tests-0123456789";
const requests = [];

function buildPdf(lines) {
  const ops = lines.map((l, i) => `BT /F1 10 Tf 40 ${760 - i * 16} Td (${l}) Tj ET`).join("\n");
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[4 0 R]/Count 1>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    "<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 3 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>",
    `<</Length ${Buffer.byteLength(ops)}>>\nstream\n${ops}\nendstream`,
  ];
  const body = objects.map((o, i) => `${i + 1} 0 obj${o}\nendobj`).join("\n");
  return Buffer.from(`%PDF-1.4\n${body}\ntrailer<</Size 6/Root 1 0 R>>\n%%EOF`, "latin1");
}

const LECTURE_PDF = buildPdf([
  "Lecture 3: Cellular Respiration.",
  "Glycolysis splits glucose into two pyruvate molecules in the cytoplasm.",
  "The Krebs cycle runs in the mitochondrial matrix and produces NADH.",
  "Oxidative phosphorylation makes most of the cell's ATP.",
]);

const COURSE = 101;
const modules = [
  {
    id: 1,
    name: "Week 3 - Energy",
    items: [
      { type: "SubHeader", title: "Readings" },
      { type: "File", title: "Lecture 3 - Cellular Respiration.pdf", content_id: 201 },
      { type: "Page", title: "Photosynthesis summary", page_url: "photosynthesis-summary" },
      { type: "File", title: "Lecture 3 slides.pptx", content_id: 203 },
      { type: "Assignment", title: "Problem set 3" },
    ],
  },
];
const files = {
  201: {
    id: 201,
    display_name: "Lecture 3 - Cellular Respiration.pdf",
    filename: "lecture3.pdf",
    "content-type": "application/pdf",
    size: LECTURE_PDF.length,
    url: `http://localhost:${CANVAS_PORT}/files/201/download?download_frd=1&verifier=v201`,
  },
  203: {
    id: 203,
    display_name: "Lecture 3 slides.pptx",
    filename: "slides.pptx",
    "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    size: 1234,
    url: `http://localhost:${CANVAS_PORT}/files/203/download?download_frd=1&verifier=v203`,
  },
};
const pages = {
  "photosynthesis-summary": {
    title: "Photosynthesis summary",
    body: "<h2>Photosynthesis</h2><p>Chloroplasts capture light energy.</p><ul><li>The light reactions split water &amp; release oxygen.</li><li>The Calvin cycle fixes carbon dioxide into sugar.</li></ul>",
  },
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const canvas = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${CANVAS_PORT}`);
  if (url.pathname === "/__requests") return json(res, 200, requests);
  requests.push({
    server: "canvas",
    path: url.pathname + url.search,
    auth: req.headers.authorization ?? null,
  });

  if (req.headers.authorization !== `Bearer ${VALID_TOKEN}`) {
    return json(res, 401, { errors: [{ message: "Invalid access token." }] });
  }
  const p = url.pathname;
  if (p === "/api/v1/users/self") return json(res, 200, { id: 42, name: "Test Student" });
  if (p === "/api/v1/courses") {
    if (url.searchParams.get("page") === "2") {
      return json(res, 200, [{ id: 102, name: "Art History", course_code: "ARTH 1000" }]);
    }
    return json(res, 200, [{ id: COURSE, name: "Biology 101", course_code: "BIOL 1010" }], {
      link: `<http://localhost:${CANVAS_PORT}/api/v1/courses?page=2&per_page=100>; rel="next"`,
    });
  }
  if (p === `/api/v1/courses/${COURSE}/modules`) return json(res, 200, modules);
  if (p === `/api/v1/courses/102/modules`) return json(res, 200, []);
  if (/^\/api\/v1\/courses\/\d+\/files$/.test(p)) {
    return json(res, 403, { status: "unauthorized", errors: [{ message: "user not authorized" }] });
  }
  let m = p.match(/^\/api\/v1\/courses\/101\/files\/(\d+)$/);
  if (m && files[m[1]]) return json(res, 200, files[m[1]]);
  m = p.match(/^\/api\/v1\/courses\/101\/pages\/([^/]+)$/);
  if (m && pages[decodeURIComponent(m[1])]) return json(res, 200, pages[decodeURIComponent(m[1])]);
  m = p.match(/^\/files\/(\d+)\/download$/);
  if (m) {
    res.writeHead(302, { location: `http://localhost:${STORAGE_PORT}/storage/${m[1]}?sig=abc` });
    return res.end();
  }
  json(res, 404, { errors: [{ message: "The specified resource does not exist." }] });
});

const storage = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${STORAGE_PORT}`);
  requests.push({ server: "storage", path: url.pathname, auth: req.headers.authorization ?? null });
  if (url.pathname === "/storage/201") {
    res.writeHead(200, { "content-type": "application/pdf" });
    return res.end(LECTURE_PDF);
  }
  res.writeHead(404);
  res.end();
});

canvas.listen(CANVAS_PORT, () => console.log(`mock Canvas on http://localhost:${CANVAS_PORT}`));
storage.listen(STORAGE_PORT, () =>
  console.log(`mock file storage on http://localhost:${STORAGE_PORT}`),
);
