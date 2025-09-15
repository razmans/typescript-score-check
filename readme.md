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
