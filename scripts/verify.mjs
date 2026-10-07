// One pass/fail command for every unit of work: lint, formatting, types, unit tests
// and the production build -- the same gates as CI. Each step's output is captured and
// only shown (its tail) when that step fails, so a green run costs a few lines.
//
//   npm run verify        # everything
//   npm run verify:fast   # skip the build (it shares .next/ with a running dev server)
import { spawn } from "node:child_process";

const TAIL_LINES = 40;
const MAX_LINE_CHARS = 300; // webpack errors can quote megabyte-long minified lines
const skipBuild = process.argv.includes("--no-build");

const steps = [
  ["lint", "npm run lint"],
  ["format", "npm run format:check"],
  ["types", "npx tsc --noEmit"],
  ["tests", "npm test"],
  ...(skipBuild ? [] : [["build", "npm run build:webpack"]]),
];

function run(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, env: { ...process.env, FORCE_COLOR: "0" } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

const failed = [];
for (const [name, command] of steps) {
  const start = Date.now();
  const { code, output } = await run(command);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  if (code === 0) {
    console.log(`PASS ${name} (${seconds}s)`);
    continue;
  }
  failed.push(name);
  console.log(`FAIL ${name} (${seconds}s, exit ${code}): ${command}`);
  const lines = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trimEnd()
    .split(/\r?\n/)
    .map((l) => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}… [truncated]` : l));
  console.log(lines.slice(-TAIL_LINES).join("\n"));
}

if (skipBuild) console.log("SKIP build (--no-build)");
console.log(failed.length ? `verify FAILED: ${failed.join(", ")}` : "verify OK");
process.exit(failed.length ? 1 : 0);
