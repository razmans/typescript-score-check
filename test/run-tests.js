// Minimal regression tests: run the built CLI against fixtures and assert on scores.
const { execFileSync } = require("child_process");
const { basename, join } = require("path");
const assert = require("assert");

const cli = join(__dirname, "..", "dist", "index.js");

function score(target) {
  const out = execFileSync(process.execPath, [cli, target, "--json"], {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function byName(results, name) {
  const found = results.find((r) => basename(r.file) === name);
  assert.ok(found, `no result for ${name}`);
  return found;
}

const good = score(join(__dirname, "good"))[0];
const bad = score(join(__dirname, "no-good"))[0];
assert.ok(good.score >= 90, `good sample should score >= 90, got ${good.score}`);
assert.ok(bad.score <= 60, `no-good sample should score <= 60, got ${bad.score}`);
assert.ok(good.score > bad.score, "good sample must outscore no-good sample");

const assertions = score(join(__dirname, "assertions"));
assert.strictEqual(
  byName(assertions, "as-only.ts").metrics.avoidAssertions,
  0,
  "`x as T` must count as an assertion",
);
assert.strictEqual(
  byName(assertions, "as-const.ts").metrics.avoidAssertions,
  1,
  "`as const` must not count as an assertion",
);

// #8: nothing to measure means n/a (null), not a perfect score
const empty = score(join(__dirname, "empty"))[0];
assert.strictEqual(empty.score, null, "empty file must have no score");
for (const [name, value] of Object.entries(empty.metrics)) {
  assert.strictEqual(value, null, `empty file metric ${name} must be n/a`);
}
// Inapplicable metrics are excluded rather than counted as 100%
assert.strictEqual(good.metrics.accessModifiers, null);
assert.strictEqual(good.metrics.useReadonly, null);

// #7: avoidAny = 1 - any / all atomic type nodes (primitives count too)
const anyResults = score(join(__dirname, "any"));
const near = (a, b) => Math.abs(a - b) < 1e-9;
assert.ok(
  near(byName(anyResults, "one-in-three.ts").metrics.avoidAny, 2 / 3),
  "1 any among 3 types should score 2/3",
);
assert.strictEqual(byName(anyResults, "only-any.ts").metrics.avoidAny, 0);
assert.strictEqual(byName(anyResults, "no-any.ts").metrics.avoidAny, 1);

console.log("All tests passed");
