import { describe, expect, it } from "vitest";
import { describeGenerationError } from "./describe-error";

describe("describeGenerationError", () => {
  it("explains the exact error a student saw: an invalid key, as serialized by Inngest", () => {
    const serialized = new Error(
      '401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}',
    );
    expect(describeGenerationError(serialized)).toMatch(/rejected the API key/);
  });

  it("uses a status property when the error still has one", () => {
    const err = Object.assign(new Error("Too many requests"), { status: 429 });
    expect(describeGenerationError(err)).toMatch(/busy/);
  });

  it("recognizes common Anthropic failures", () => {
    expect(
      describeGenerationError(
        new Error("400 Your credit balance is too low to access the Anthropic API."),
      ),
    ).toMatch(/out of credits/);
    expect(describeGenerationError(new Error("529 overloaded_error"))).toMatch(/overloaded/);
    expect(
      describeGenerationError(new Error("Invalid flashcards from model: too many cards")),
    ).toMatch(/unexpected format/);
  });

  it("never leaks raw internals for unknown errors", () => {
    const text = describeGenerationError(new Error("ECONNRESET at socket.js:123 {secret: 1}"));
    expect(text).toBe("Something went wrong while generating flashcards. Try again.");
  });
});
