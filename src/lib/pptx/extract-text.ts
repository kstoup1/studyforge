import { inflateRawSync } from "node:zlib";

export class PptxExtractionError extends Error {}

export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

const ENTRY_LIMIT = 20 * 1024 * 1024;
const TOTAL_LIMIT = 100 * 1024 * 1024;

/**
 * Extracts plain text from a PowerPoint's raw bytes. Nothing is written to disk and the
 * buffer is never persisted -- see docs/PLAN.md §6 for why StudyForge only ever
 * keeps the extracted text, not the original file.
 */
export async function extractPptxText(data: Uint8Array): Promise<string> {
  try {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const check = (offset: number, length: number) => {
      if (offset < 0 || length < 0 || offset + length > bytes.length)
        throw new PptxExtractionError("Invalid ZIP offset or truncated PowerPoint file");
    };
    if (!looksLikeZip(bytes)) throw new PptxExtractionError("Not a ZIP PowerPoint file");
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (
        bytes.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
      ) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new PptxExtractionError("ZIP end of central directory not found");
    const count = bytes.readUInt16LE(end + 10);
    const size = bytes.readUInt32LE(end + 12);
    let cursor = bytes.readUInt32LE(end + 16);
    if (count === 0xffff || size === 0xffffffff || cursor === 0xffffffff)
      throw new PptxExtractionError("ZIP64 PowerPoint files are not supported");
    if (count > 2000) throw new PptxExtractionError("ZIP exceeds the 2000 entry limit");
    if (
      bytes.readUInt16LE(end + 4) ||
      bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== count
    )
      throw new PptxExtractionError("Multi-disk ZIP files are not supported");
    check(cursor, size);
    const directoryEnd = cursor + size;
    if (directoryEnd > end) throw new PptxExtractionError("Invalid ZIP central directory bounds");
    const slides: {
      number: number;
      offset: number;
      compressed: number;
      uncompressed: number;
      method: number;
    }[] = [];
    for (let i = 0; i < count; i++) {
      check(cursor, 46);
      if (cursor + 46 > directoryEnd || bytes.readUInt32LE(cursor) !== 0x02014b50)
        throw new PptxExtractionError("Invalid ZIP central directory entry");
      if (bytes.readUInt16LE(cursor + 8) & 1)
        throw new PptxExtractionError("Encrypted ZIP entries are not supported");
      const method = bytes.readUInt16LE(cursor + 10);
      const compressed = bytes.readUInt32LE(cursor + 20);
      const uncompressed = bytes.readUInt32LE(cursor + 24);
      const offset = bytes.readUInt32LE(cursor + 42);
      if ([compressed, uncompressed, offset].includes(0xffffffff))
        throw new PptxExtractionError("ZIP64 PowerPoint files are not supported");
      const nameLength = bytes.readUInt16LE(cursor + 28);
      const length =
        46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
      check(cursor, length);
      if (cursor + length > directoryEnd) throw new PptxExtractionError("Invalid ZIP entry bounds");
      const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
      if (match) {
        slides.push({ number: Number(match[1]), offset, compressed, uncompressed, method });
      }
      cursor += length;
    }
    if (!slides.length)
      throw new PptxExtractionError("This doesn't look like a PowerPoint (.pptx) file");
    let total = 0;
    const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    const texts = slides
      .sort((a, b) => a.number - b.number)
      .map((slide) => {
        check(slide.offset, 30);
        if (bytes.readUInt32LE(slide.offset) !== 0x04034b50)
          throw new PptxExtractionError("Invalid ZIP local file header");
        if (bytes.readUInt16LE(slide.offset + 6) & 1)
          throw new PptxExtractionError("Encrypted ZIP entries are not supported");
        const start =
          slide.offset +
          30 +
          bytes.readUInt16LE(slide.offset + 26) +
          bytes.readUInt16LE(slide.offset + 28);
        check(start, slide.compressed);
        if (slide.uncompressed > ENTRY_LIMIT)
          throw new PptxExtractionError("Slide exceeds the 20MB uncompressed entry limit");
        if (total + slide.uncompressed > TOTAL_LIMIT)
          throw new PptxExtractionError("Slides exceed the 100MB total uncompressed limit");
        const compressed = bytes.subarray(start, start + slide.compressed);
        let content: Buffer;
        if (slide.method === 0) content = compressed;
        else if (slide.method === 8) {
          try {
            content = inflateRawSync(compressed, {
              maxOutputLength: Math.min(slide.uncompressed, ENTRY_LIMIT),
            });
          } catch (err) {
            if (err instanceof Error && "code" in err && err.code === "ERR_BUFFER_TOO_LARGE")
              throw new PptxExtractionError("Slide exceeds the 20MB uncompressed entry limit");
            throw err;
          }
        } else throw new PptxExtractionError(`Unsupported ZIP compression method ${slide.method}`);
        if (content.length > ENTRY_LIMIT)
          throw new PptxExtractionError("Slide exceeds the 20MB uncompressed entry limit");
        total += content.length;
        if (total > TOTAL_LIMIT)
          throw new PptxExtractionError("Slides exceed the 100MB total uncompressed limit");
        if (content.length !== slide.uncompressed)
          throw new PptxExtractionError("Invalid ZIP uncompressed size");
        return [...content.toString("utf8").matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
          .map((paragraph) =>
            [...paragraph[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/\s*>/g)]
              .map((run) =>
                run[1] === undefined
                  ? "\n"
                  : run[1].replace(
                      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
                      (_, code: string) =>
                        code[0] === "#"
                          ? String.fromCodePoint(
                              parseInt(
                                code.slice(code[1].toLowerCase() === "x" ? 2 : 1),
                                code[1].toLowerCase() === "x" ? 16 : 10,
                              ),
                            )
                          : entities[code.toLowerCase()],
                    ),
              )
              .join(""),
          )
          .flatMap((paragraph) => paragraph.split("\n"))
          .filter((line) => line.trim())
          .join("\n");
      });
    const text = texts.join("\n\n").trim();
    if (!text)
      throw new PptxExtractionError("No extractable text found (the slides may be images only)");
    return text;
  } catch (err) {
    if (err instanceof PptxExtractionError) throw err;
    throw new PptxExtractionError(
      `Failed to read PowerPoint file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
