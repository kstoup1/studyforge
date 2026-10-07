import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractPptxText, looksLikeZip, PptxExtractionError } from "./extract-text";

function zip(entries: { name: string; text: string; stored?: boolean }[]): Buffer {
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

function slide(paragraphs: string[][]): string {
  return `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs.map((runs) => `<a:p>${runs.map((text) => `<a:r><a:t>${text}</a:t></a:r>`).join("")}</a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

const entry = (number: number, paragraphs: string[][], stored = false) => ({
  name: `ppt/slides/slide${number}.xml`,
  text: slide(paragraphs),
  stored,
});

describe("extractPptxText", () => {
  it("extracts real ZIP slide XML in numeric order, concatenates runs and ignores notes/layouts", async () => {
    const fixture = zip([
      {
        name: "[Content_Types].xml",
        text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
        stored: true,
      },
      {
        name: "ppt/presentation.xml",
        text: '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      },
      entry(10, [["Slide ten"]]),
      entry(2, [["Slide two"]], true),
      entry(1, [["Energy &amp; ", "ATP"], ["&lt; &gt; &quot; &apos; &#65; &#x1F600;"], [""]]),
      { name: "ppt/notesSlides/notesSlide1.xml", text: slide([["Ignored notes"]]) },
      { name: "ppt/slideLayouts/slideLayout1.xml", text: slide([["Ignored layout"]]) },
    ]);
    expect(await extractPptxText(fixture)).toBe(
      "Energy & ATP\n< > \" ' A \u{1F600}\n\nSlide two\n\nSlide ten",
    );
  });
  it("preserves paragraph breaks and drops empty lines", async () => {
    const text = slide([["First</a:t></a:r><a:br/><a:r><a:t>Second"], ["   "]]);
    await expect(extractPptxText(zip([{ name: "ppt/slides/slide1.xml", text }]))).resolves.toBe(
      "First\nSecond",
    );
  });
  it.each([Buffer.from("not a zip"), Buffer.alloc(0)])("rejects non-ZIP bytes", async (bytes) => {
    await expect(extractPptxText(bytes)).rejects.toBeInstanceOf(PptxExtractionError);
  });
  it("rejects ZIPs without slides", async () => {
    await expect(extractPptxText(zip([{ name: "other.xml", text: "text" }]))).rejects.toThrow(
      /PowerPoint/,
    );
  });
  it("rejects image-only slides", async () => {
    await expect(extractPptxText(zip([entry(1, [[]])]))).rejects.toThrow(
      "No extractable text found (the slides may be images only)",
    );
  });
  it("rejects truncated ZIPs with a readable extraction error", async () => {
    const bytes = zip([entry(1, [["text"]])]);
    await expect(extractPptxText(bytes.subarray(0, bytes.length - 1))).rejects.toBeInstanceOf(
      PptxExtractionError,
    );
  });
  it("uses central sizes and local name/extra lengths for data-descriptor entries", async () => {
    const bytes = zip([entry(1, [["descriptor text"]])]);
    const directory = bytes.readUInt32LE(bytes.length - 6);
    const nameEnd = 30 + bytes.readUInt16LE(26);
    const extra = Buffer.from([0xfe, 0xca, 0, 0]);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    bytes.copy(descriptor, 4, 14, 26);
    const fixture = Buffer.concat([
      bytes.subarray(0, nameEnd),
      extra,
      bytes.subarray(nameEnd, directory),
      descriptor,
      bytes.subarray(directory),
    ]);
    fixture.writeUInt16LE(8, 6);
    fixture.writeUInt16LE(extra.length, 28);
    fixture.fill(0, 14, 26);
    fixture.writeUInt16LE(8, directory + extra.length + descriptor.length + 8);
    fixture.writeUInt32LE(directory + extra.length + descriptor.length, fixture.length - 6);
    await expect(extractPptxText(fixture)).resolves.toBe("descriptor text");
  });
  it("caps inflation even when the declared size is false", async () => {
    const bytes = zip([entry(1, [["x".repeat(21 * 1024 * 1024)]])]);
    const directory = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(1, directory + 24);
    await expect(extractPptxText(bytes)).rejects.toThrow(/20MB/);
  });
  it.each(["offset", "method", "zip64", "entry limit", "total limit", "count"])(
    "rejects unsafe %s metadata",
    async (kind) => {
      const bytes = zip([entry(1, [["text"]])]);
      const end = bytes.length - 22;
      const directory = bytes.readUInt32LE(end + 16);
      if (kind === "offset") bytes.writeUInt32LE(bytes.length + 1, directory + 42);
      if (kind === "method") bytes.writeUInt16LE(99, directory + 10);
      if (kind === "zip64") bytes.writeUInt32LE(0xffffffff, directory + 20);
      if (kind === "entry limit") bytes.writeUInt32LE(20 * 1024 * 1024 + 1, directory + 24);
      if (kind === "count") {
        bytes.writeUInt16LE(2001, end + 8);
        bytes.writeUInt16LE(2001, end + 10);
      }
      if (kind === "total limit") {
        const big = "x".repeat(18 * 1024 * 1024);
        await expect(
          extractPptxText(
            zip([
              entry(1, [[big]]),
              entry(2, [[big]]),
              entry(3, [[big]]),
              entry(4, [[big]]),
              entry(5, [[big]]),
              entry(6, [[big]]),
            ]),
          ),
        ).rejects.toThrow(/100MB/);
        return;
      }
      await expect(extractPptxText(bytes)).rejects.toBeInstanceOf(PptxExtractionError);
    },
  );
});

describe("looksLikeZip", () => {
  it("recognizes only a complete local-header signature", () => {
    expect(looksLikeZip(zip([entry(1, [["text"]])]))).toBe(true);
    expect(looksLikeZip(Buffer.from("%PDF-"))).toBe(false);
    expect(looksLikeZip(Buffer.from([0x50, 0x4b, 3]))).toBe(false);
    expect(looksLikeZip(Buffer.alloc(0))).toBe(false);
  });
});
