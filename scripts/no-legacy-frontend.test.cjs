const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourceRoot = path.resolve(__dirname, "..", "src");
const forbiddenDataMarker = ["mock", "-data"].join("");
const forbiddenDemoMarker = ["demo", ":"].join("");
const forbiddenLegacyPath = /\/api\/(?!v1(?:\/|$|\$))/;
const forbiddenApiBaseFallback = /VITE_API_BASE\s*\|\|\s*["']{2}/;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(absolutePath) : [absolutePath];
  });
}

test("frontend source contains no legacy API or demo data markers", () => {
  const violations = [];
  for (const filePath of sourceFiles(sourceRoot)) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
      if (
        line.includes(forbiddenDataMarker) ||
        line.includes(forbiddenDemoMarker) ||
        forbiddenLegacyPath.test(line) ||
        forbiddenApiBaseFallback.test(line)
      ) {
        violations.push(`${path.relative(sourceRoot, filePath)}:${lineIndex + 1}`);
      }
    }
  }
  assert.deepEqual(violations, [], "remove legacy API and demo markers from frontend source");
});
