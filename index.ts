#!/usr/bin/env node

import { program } from "commander";
import { Project } from "ts-morph";
import { existsSync } from "fs";
import { resolve } from "path";
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
  weights,
} from "./functions/helper";

program
  .version("1.0.0")
  .description("Score TypeScript code for best practices and simplicity")
  .option("--json", "Output as JSON")
  .argument("<path>", "Path to TypeScript file or directory")
  .action((path, options) => {
    const target = resolve(path);
    if (!existsSync(target)) {
      program.error(`path not found: ${path}`);
    }
    const project = new Project();
    const files = getTsFiles(target);
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
    console.log(
      options.json
        ? JSON.stringify(scores, null, 2)
        : formatHumanReadable(scores),
    );
  });

program.parse(process.argv);
