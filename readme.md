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
```

## Output
For each file, you get:
- File path
- Score (0-100)
- Metrics breakdown (percentage for each metric)
- Suggestions for improvement

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
