// A fake Canvas LMS for end-to-end tests of the Canvas import, so they never touch a
// real school's Canvas or a real student's token. Mirrors the real API shapes the app
// uses (src/lib/canvas/client.ts), including the awkward parts:
//   - PDF and PPTX files are served as real in-memory documents
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
import { crc32, deflateRawSync } from "node:zlib";

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

function buildPptx(slides) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  const escape = (text) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const entries = [
    {
      name: "[Content_Types].xml",
      text: `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
      stored: true,
    },
    {
      name: "_rels/.rels",
      text: `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    },
    {
      name: "ppt/presentation.xml",
      text: `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      text: `<Relationships xmlns="${rels}">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${r}/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`,
    },
    ...slides.map((paragraphs, i) => ({
      name: `ppt/slides/slide${i + 1}.xml`,
      text: `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((text) => `<a:p><a:r><a:t>${escape(text)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    })),
  ];
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.text);
    const method = entry.stored ? 0 : 8;
    const compressed = method === 0 ? data : deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

const LECTURE_PPTX = buildPptx([
  [
    "Lecture 3 slides: ATP synthase.",
    "ATP synthase is powered by the proton gradient across the inner membrane.",
  ],
  ["Each NADH yields about 2.5 ATP during oxidative phosphorylation."],
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
      { type: "File", title: "Syllabus.docx", content_id: 204 },
      { type: "Assignment", title: "Problem set 3" },
    ],
  },
];
const files = {
  204: {
    id: 204,
    display_name: "Syllabus.docx",
    filename: "syllabus.docx",
    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
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
    size: LECTURE_PPTX.length,
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
  if (url.pathname === "/storage/203") {
    res.writeHead(200, { "content-type": files[203]["content-type"] });
    return res.end(LECTURE_PPTX);
  }
  res.writeHead(404);
  res.end();
});

canvas.listen(CANVAS_PORT, () => console.log(`mock Canvas on http://localhost:${CANVAS_PORT}`));
storage.listen(STORAGE_PORT, () =>
  console.log(`mock file storage on http://localhost:${STORAGE_PORT}`),
);
