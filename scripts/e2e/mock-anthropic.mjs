// A stand-in for the Anthropic Messages API, for end-to-end testing the *successful*
// generation path without a real API key. The app talks to it through the real
// Anthropic SDK (which honours ANTHROPIC_BASE_URL), so everything except the model
// itself is exercised for real: the SDK call, the forced tool_use response shape,
// zod validation, chunking, persistence, and the UI.
//
//   node scripts/e2e/mock-anthropic.mjs            # listens on :4010
//   ANTHROPIC_BASE_URL=http://localhost:4010 npm run dev:webpack
//
// Test hooks: GET /__requests returns every /v1/messages body received;
// POST /__reset clears them.
import http from "node:http";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);
let requests = [];

/** Deterministic "flashcards": one per sentence/line of the chunk, max 5. */
function cardsFor(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
    .slice(0, 5)
    .map((sentence) => ({
      question: `Explain: ${sentence.split(/\s+/).slice(0, 6).join(" ")}…?`,
      answer: sentence,
    }));
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/__requests") return send(res, 200, requests);
    if (req.method === "POST" && req.url === "/__reset") {
      requests = [];
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const body = JSON.parse(raw);
      requests.push(body);
      const text = String(body.messages?.[0]?.content ?? "");
      return send(res, 200, {
        id: `msg_mock_${requests.length}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [
          {
            type: "tool_use",
            id: `toolu_mock_${requests.length}`,
            name: "record_flashcards",
            input: { cards: cardsFor(text) },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: Math.ceil(text.length / 4), output_tokens: 100 },
      });
    }
    send(res, 404, { type: "error", error: { type: "not_found_error", message: req.url } });
  });
});

server.listen(PORT, () => console.log(`mock Anthropic API on http://localhost:${PORT}`));
