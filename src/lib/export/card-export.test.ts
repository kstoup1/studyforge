import { describe, expect, it } from "vitest";
import { cardsToAnkiTsv, cardsToCsv } from "./card-export";

describe("cardsToCsv", () => {
  it("returns just a header for no cards", () => {
    expect(cardsToCsv([])).toBe("question,answer\r\n");
  });

  it("writes plain fields unquoted", () => {
    const csv = cardsToCsv([{ question: "What is SM-2?", answer: "A scheduling algorithm" }]);
    expect(csv).toBe("question,answer\r\nWhat is SM-2?,A scheduling algorithm\r\n");
  });

  it("quotes fields containing commas", () => {
    const csv = cardsToCsv([{ question: "List a, b, c", answer: "ok" }]);
    expect(csv).toBe('question,answer\r\n"List a, b, c",ok\r\n');
  });

  it("quotes and doubles embedded quotes", () => {
    const csv = cardsToCsv([{ question: 'Say "hello"', answer: "ok" }]);
    expect(csv).toBe('question,answer\r\n"Say ""hello""",ok\r\n');
  });

  it("quotes fields containing newlines", () => {
    const csv = cardsToCsv([{ question: "Line1\nLine2", answer: "ok" }]);
    expect(csv).toBe('question,answer\r\n"Line1\nLine2",ok\r\n');
  });

  it("handles multiple cards in order", () => {
    const csv = cardsToCsv([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
    expect(csv).toBe("question,answer\r\nQ1,A1\r\nQ2,A2\r\n");
  });
});

describe("cardsToAnkiTsv", () => {
  it("returns empty string for no cards", () => {
    expect(cardsToAnkiTsv([])).toBe("");
  });

  it("writes tab-separated question/answer per line", () => {
    const tsv = cardsToAnkiTsv([{ question: "What is SM-2?", answer: "A scheduling algorithm" }]);
    expect(tsv).toBe("What is SM-2?\tA scheduling algorithm\n");
  });

  it("collapses embedded tabs to spaces so they can't be mistaken for the delimiter", () => {
    const tsv = cardsToAnkiTsv([{ question: "a\tb", answer: "ok" }]);
    expect(tsv).toBe("a b\tok\n");
  });

  it("converts embedded newlines to <br> since Anki fields are one line", () => {
    const tsv = cardsToAnkiTsv([{ question: "Line1\nLine2", answer: "ok" }]);
    expect(tsv).toBe("Line1<br>Line2\tok\n");
  });

  it("handles multiple cards, one per line", () => {
    const tsv = cardsToAnkiTsv([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "A2" },
    ]);
    expect(tsv).toBe("Q1\tA1\nQ2\tA2\n");
  });
});
