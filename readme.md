# TypeScript Score Check

A CLI tool to score TypeScript code for best practices and simplicity.

## Features
- **Scores TypeScript files** for adherence to best practices.
- **Metrics evaluated:**
  - Avoid use of `any`
  - Explicit return types for functions
  - Use of access modifiers
  - Code complexity
  - Nesting depth
  - Prefer `const` over `let`
  - Avoid type assertions
  - Use of `readonly` for properties
  - Avoid use of `var`
  - Use of optional chaining
- **Human-readable and JSON output**
- **Suggestions** for improving code quality

## Usage

### Command Line Interface

```bash

# Analyze a single file
npx @razmans/ts-score-check ./src/test.ts

# Analyze an entire directory
npx @razmans/ts-score-check ./src

# JSON output, skip some names, fail CI below a score of 80
npx @razmans/ts-score-check ./src --json -e generated -e legacy --min-score 80
```

### Options
- `--json` — output JSON
- `-e, --exclude <name>` — skip files or directories with this name (repeatable)
- `--min-score <n>` — exit with code 1 if any file scores below `n` (0-100). Files with no score (`null`) are ignored.
- `-V, --version` — print the version

## Output
For each file, you get:
- File path
- Score (0-100)
- Metrics breakdown (percentage for each metric)
- Suggestions for improvement

### File scanning and errors
- Directories are scanned recursively for `.ts`, `.tsx`, `.mts` and `.cts` files. `node_modules`, hidden directories (`.git`, ...) and declaration files (`.d.ts`, `.d.mts`, `.d.cts`) are skipped, plus anything matched by `--exclude`. A file path passed explicitly is always scored. Symlinked directories are not followed; broken symlinks and unreadable entries are skipped with a warning on stderr.
- A nonexistent path prints an error and exits with code 1. If a file cannot be scored, a warning is printed and the exit code is 1; other files are still scored.
- A file with syntax errors is still scored (on what the parser could read), but a warning is printed, the JSON result has a non-empty `parseErrors` array, and the exit code is 1.
- Finding no TypeScript files prints a warning and exits with code 1.

## How Scoring Works
- Each metric is weighted (see `functions/helper.ts`).
- The score is a weighted sum of all metrics, normalized to 100.
- Suggestions are generated for metrics that are not perfect.
- A metric with nothing to measure in a file (e.g. no classes for access modifiers) is `n/a` (`null` in JSON). It is left out of the score and the remaining weights are re-normalised. A file where nothing applies has no score.

### Metric details
- **avoidAny**: `1 - any / type nodes` (keyword types, type references and literal types).
- **returnTypes / complexity / nesting**: scored per function: declarations, methods, constructors, accessors, and arrow/function expressions assigned to a name. Inline callbacks count toward their enclosing function. Return types are not required on constructors, setters, inline callbacks or functions typed by their variable annotation.
- **preferConst**: a `let` is only penalised if it is never reassigned (assignment, `++`/`--`, destructuring assignment) and has an initializer. `for (let x of ...)` is penalised.
- **avoidAssertions**: counts `x as T`, `<T>x` and `x!` (`as const` is allowed).
- **optionalChaining**: manual null checks (`x && x.y`, `x != null ? x.y : d`) vs `?.` and `??`. Plain boolean `&&` is ignored.

## Project Structure
- `index.ts` — CLI entry point
- `functions/` — Scoring logic and helpers
- `test/` — Example TypeScript files for testing

## Requirements
- Node.js
- TypeScript
- [ts-morph](https://github.com/dsherret/ts-morph)
- [commander](https://github.com/tj/commander.js)

## License
MIT
