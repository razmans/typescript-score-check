#!/usr/bin/env node

import { program } from "commander";
import { Project } from "ts-morph";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  calculateAccessModifiers,
  calculateAvoidAny,
  calculateAvoidAssertions,
  calculateAvoidVar,
  calculateComplexity,
  calculateNesting,
  calculateOptionalChaining,
  calculatePreferConst,
  calculateReturnTypes,
  calculateScore,
  calculateUseReadonly,
  formatHumanReadable,
  generateSuggestions,
  getSyntaxErrors,
  getTsFiles,
  ScoreResult,
} from "./functions/helper";

// Read at runtime so the reported version can never drift from package.json
function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .version(packageVersion())
  .description("Score TypeScript code for best practices and simplicity")
  .option("--json", "Output as JSON")
  .option(
    "-e, --exclude <name>",
    "Skip files or directories with this name (repeatable)",
    collect,
    [],
  )
  .option(
    "--min-score <n>",
    "Exit with code 1 if any file scores below n (0-100)",
  )
  .argument("<path>", "Path to TypeScript file or directory")
  .action((path, options) => {
    const target = resolve(path);
    if (!existsSync(target)) {
      program.error(`path not found: ${path}`);
    }
    let minScore: number | undefined;
    if (options.minScore !== undefined) {
      minScore = Number(options.minScore);
      if (options.minScore.trim() === "" || !(minScore >= 0 && minScore <= 100)) {
        program.error(`--min-score must be a number from 0 to 100`);
      }
    }
    const project = new Project();
    const files = getTsFiles(target, options.exclude);
    if (files.length === 0) {
      console.error(`warning: no TypeScript files found in ${path}`);
      process.exitCode = 1;
    }
    const scores: ScoreResult[] = [];
    for (const file of files) {
      // One unreadable or pathological file must not abort the whole run
      try {
        const sourceFile = project.addSourceFileAtPath(file);
        const metrics = {
          avoidAny: calculateAvoidAny(sourceFile),
          returnTypes: calculateReturnTypes(sourceFile),
          accessModifiers: calculateAccessModifiers(sourceFile),
          complexity: calculateComplexity(sourceFile),
          nesting: calculateNesting(sourceFile),
          preferConst: calculatePreferConst(sourceFile),
          avoidAssertions: calculateAvoidAssertions(sourceFile),
          useReadonly: calculateUseReadonly(sourceFile),
          avoidVar: calculateAvoidVar(sourceFile),
          optionalChaining: calculateOptionalChaining(sourceFile),
        };
        const parseErrors = getSyntaxErrors(sourceFile);
        if (parseErrors.length > 0) {
          console.error(
            `warning: ${file} has ${parseErrors.length} syntax error(s); scores may be unreliable`,
          );
          process.exitCode = 1;
        }
        scores.push({
          file,
          score: calculateScore(metrics),
          metrics,
          suggestions: generateSuggestions(metrics),
          parseErrors,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`warning: could not score ${file}: ${reason}`);
        process.exitCode = 1;
      }
    }
    if (minScore !== undefined) {
      for (const { file, score } of scores) {
        // A file with nothing to score (null) cannot fall below the threshold
        if (score !== null && score < minScore) {
          console.error(`error: ${file} scored ${score}, below ${minScore}`);
          process.exitCode = 1;
        }
      }
    }
    console.log(
      options.json
        ? JSON.stringify(scores, null, 2)
        : formatHumanReadable(scores),
    );
  });

program.parse(process.argv);
