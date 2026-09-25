import type { GeneratedCard } from "./types";

// Provider-independent text handling shared by every FlashcardGenerator.

export const MAX_CHUNK_CHARS = 12_000;

/**
 * Splits text into chunks no larger than maxChars, preferring the most natural break
 * available: paragraphs (blank lines), then single line breaks, then sentence ends,
 * and only as a last resort a hard cut. The finer levels matter for PDFs: unpdf's
 * mergePages output usually has no blank lines at all, so paragraph-only splitting
 * used to send an entire PDF to the model as one oversized chunk.
 * Pure function, no I/O -- independently unit-tested.
 */
export function chunkText(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  return packPieces(splitToFit(trimmed, maxChars, 0), maxChars);
}

// Coarsest to finest. Each keeps its delimiter when rejoined by packPieces.
const SPLITTERS: { pattern: RegExp; joiner: string }[] = [
  { pattern: /\n\s*\n/, joiner: "\n\n" },
  { pattern: /\n/, joiner: "\n" },
  { pattern: /(?<=[.!?])\s+/, joiner: " " },
];

interface Piece {
  text: string;
  joiner: string; // what goes between this piece and the previous one
}

/** Breaks text into pieces that each fit in maxChars, using the coarsest splitter
 * that works and recursing to finer ones only for pieces that are still too big. */
function splitToFit(text: string, maxChars: number, level: number): Piece[] {
  if (text.length <= maxChars) return [{ text, joiner: "\n\n" }];
  if (level >= SPLITTERS.length) {
    const pieces: Piece[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      pieces.push({ text: text.slice(i, i + maxChars), joiner: "" });
    }
    return pieces;
  }
  const { pattern, joiner } = SPLITTERS[level];
  const parts = text.split(pattern).filter((p) => p.trim().length > 0);
  if (parts.length === 1) return splitToFit(text, maxChars, level + 1);
  return parts.flatMap((part, i) =>
    splitToFit(part, maxChars, level + 1).map((piece, j) =>
      // The first sub-piece of each part is joined with this level's delimiter; the
      // rest keep the finer delimiter they were split on.
      j === 0 && i > 0 ? { ...piece, joiner } : piece,
    ),
  );
}

/** Greedily packs consecutive pieces into chunks of at most maxChars. */
function packPieces(pieces: Piece[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}${piece.joiner}${piece.text}` : piece.text;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = piece.text;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Merges chunk results, drops exact-duplicate questions (case/whitespace-insensitive,
 * common when the same concept appears in adjacent chunks), and caps the total. */
export function mergeAndCap(chunkResults: GeneratedCard[][], maxCards: number): GeneratedCard[] {
  const seen = new Set<string>();
  const merged: GeneratedCard[] = [];
  for (const cards of chunkResults) {
    for (const card of cards) {
      const key = card.question.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(card);
      if (merged.length >= maxCards) return merged;
    }
  }
  return merged;
}
