// Minimal regression tests: run the built CLI against fixtures and assert on scores.
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
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

// #6: only real manual null checks count; plain boolean && does not
const chaining = score(join(__dirname, "chaining"));
assert.ok(
  near(byName(chaining, "mixed.ts").metrics.optionalChaining, 0.5),
  "2 manual + 2 modern null checks should score 0.5",
);
assert.strictEqual(
  byName(chaining, "chained.ts").metrics.optionalChaining,
  0,
  "`a && a.b && a.b.c` is two manual checks",
);
assert.strictEqual(
  byName(chaining, "negated.ts").metrics.optionalChaining,
  0,
  "`x == null ? d : x.y` is a manual check",
);
assert.strictEqual(
  byName(chaining, "boolean-only.ts").metrics.optionalChaining,
  null,
  "plain boolean && is not a null check",
);

// #4: only a `let` that is never reassigned is a violation
const consts = score(join(__dirname, "const"));
assert.ok(
  near(byName(consts, "let-cases.ts").metrics.preferConst, 0.8),
  "1 unnecessary let among 5 declarations should score 0.8",
);
assert.strictEqual(
  byName(consts, "destructure.ts").metrics.preferConst,
  1,
  "lets reassigned by destructuring are justified",
);
assert.strictEqual(
  byName(consts, "for-of.ts").metrics.preferConst,
  0,
  "`for (let x of ...)` should be const",
);

// #5: methods and arrow functions are scored, not just top-level declarations
const fns = score(join(__dirname, "functions"));
const units = byName(fns, "units.ts").metrics;
assert.strictEqual(units.returnTypes, 0, "method and arrow fn lack return types");
assert.ok(near(units.nesting, 0.25), "method nesting 3 should score 0.25");
assert.ok(near(units.complexity, 0.7), "avg complexity 2.5 should score 0.7");

const inlineTop = byName(fns, "inline-top.ts").metrics;
assert.strictEqual(inlineTop.returnTypes, null, "callbacks need no return type");
assert.strictEqual(inlineTop.complexity, 1);

const inlineNested = byName(fns, "inline-nested.ts").metrics;
assert.strictEqual(inlineNested.returnTypes, 1);
assert.ok(
  near(inlineNested.complexity, 0.8),
  "callback decisions count toward the enclosing function",
);

assert.strictEqual(
  byName(fns, "typed.ts").metrics.returnTypes,
  null,
  "contextually typed functions are exempt",
);

const nestedUnit = byName(fns, "nested-unit.ts").metrics;
assert.strictEqual(nestedUnit.returnTypes, 1);
assert.ok(near(nestedUnit.complexity, 0.8), "inner fn scored separately: avg 2");
assert.ok(near(nestedUnit.nesting, 0.5), "inner fn nesting 2, outer not charged");

// #11: every assertion kind is in the denominator, so the metric stays in [0, 1]
assert.ok(
  near(byName(assertions, "non-null.ts").metrics.avoidAssertions, 0.25),
  "3 non-null assertions among 4 expressions should score 0.25, never negative",
);

// #12: `else if` chains are flat, a real nested `if` inside one is deeper
const nesting = score(join(__dirname, "nesting"));
assert.ok(
  near(byName(nesting, "else-if.ts").metrics.nesting, 0.75),
  "an else-if chain is one level deep (0.75), not four",
);
assert.ok(
  near(byName(nesting, "else-if-nested.ts").metrics.nesting, 0.5),
  "an if nested in an else-if body is two levels deep (0.5)",
);

// #13: `using` is block scoped, only `var` is flagged
const vars = score(join(__dirname, "var"));
assert.strictEqual(byName(vars, "using.ts").metrics.avoidVar, 1);
assert.strictEqual(byName(vars, "var.ts").metrics.avoidVar, 0);

// #18: try/catch adds one path (the catch), not two
const complexity = score(join(__dirname, "complexity"));
assert.ok(
  near(byName(complexity, "try-catch.ts").metrics.complexity, 0.8),
  "try/catch is complexity 2 (score 0.8), not 3",
);

// #14: the CLI must not crash on bad paths, bad symlinks or very deep trees
const tmp = fs.mkdtempSync(join(os.tmpdir(), "ts-score-check-"));
try {
  const missing = spawnSync(process.execPath, [cli, join(tmp, "nope")], {
    encoding: "utf8",
  });
  assert.strictEqual(missing.status, 1, "missing path must exit with code 1");
  assert.ok(missing.stderr.includes("path not found"), "clear error message");
  assert.ok(!missing.stderr.includes("node:fs"), "no raw fs stack trace");

  const links = join(tmp, "links");
  fs.mkdirSync(links);
  fs.writeFileSync(join(links, "ok.ts"), "const ok = 1;\n");
  let symlinksSupported = true;
  try {
    fs.symlinkSync("/nonexistent/target.ts", join(links, "broken.ts"));
    fs.symlinkSync("..", join(links, "loop"));
  } catch {
    symlinksSupported = false;
    console.log("skipping symlink tests: symlinks not supported here");
  }
  if (symlinksSupported) {
    const run = spawnSync(process.execPath, [cli, links, "--json"], {
      encoding: "utf8",
    });
    assert.strictEqual(run.status, 0, `broken symlinks must not fail: ${run.stderr}`);
    assert.deepStrictEqual(
      JSON.parse(run.stdout).map((r) => basename(r.file)),
      ["ok.ts"],
    );
    assert.ok(run.stderr.includes("skipped"), "broken symlink is reported");
  }

  const deep = join(tmp, "deep");
  fs.mkdirSync(deep);
  const terms = Array.from({ length: 20000 }, (_, i) => `"s${i}"`).join(" + ");
  fs.writeFileSync(join(deep, "chain.ts"), `function f(): string {\n  return ${terms};\n}\n`);
  const chain = spawnSync(process.execPath, [cli, deep, "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.strictEqual(chain.status, 0, `deep chain must not crash: ${chain.stderr.slice(0, 200)}`);
  assert.ok(
    JSON.parse(chain.stdout)[0].score !== null,
    "deep expression chain must still be scored",
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// #15: preferConst must scale (was quadratic: 4,000 lets took ~42s)
const lotsDir = fs.mkdtempSync(join(os.tmpdir(), "ts-score-check-lets-"));
try {
  const lines = [];
  for (let i = 0; i < 4000; i++) lines.push(`let v${i} = ${i};`);
  for (let i = 0; i < 4000; i += 2) lines.push(`v${i}++;`);
  fs.writeFileSync(join(lotsDir, "lets.ts"), lines.join("\n") + "\n");
  const started = Date.now();
  const lots = score(lotsDir)[0];
  const seconds = (Date.now() - started) / 1000;
  assert.ok(near(lots.metrics.preferConst, 0.5), "half of the lets are reassigned");
  assert.ok(seconds < 15, `4,000 lets should score quickly, took ${seconds}s`);
} finally {
  fs.rmSync(lotsDir, { recursive: true, force: true });
}

console.log("All tests passed");
