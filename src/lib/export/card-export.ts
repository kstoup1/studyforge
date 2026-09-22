/**
 * Pure, dependency-free card-export formatting -- same pattern as sm2.ts and
 * dashboard/stats.ts: no Prisma/Next imports, so these are fully unit-testable
 * without a database or an HTTP request.
 */

export interface ExportableCard {
  question: string;
  answer: string;
}

function csvField(value: string): string {
  // RFC 4180: quote any field containing the delimiter, a quote, or a line break,
  // and double up embedded quotes.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function cardsToCsv(cards: ExportableCard[]): string {
  const header = "question,answer";
  const rows = cards.map((c) => `${csvField(c.question)},${csvField(c.answer)}`);
  return [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * Anki's plain-text note import splits each line on a single tab with no quoting
 * support, so a literal tab or newline inside a field would corrupt the import --
 * tabs collapse to a space and newlines become "<br>" (Anki fields render as HTML).
 */
function ankiField(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r\n|\r|\n/g, "<br>");
}

export function cardsToAnkiTsv(cards: ExportableCard[]): string {
  if (cards.length === 0) return "";
  return cards.map((c) => `${ankiField(c.question)}\t${ankiField(c.answer)}`).join("\n") + "\n";
}
