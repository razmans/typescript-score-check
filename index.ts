#!/usr/bin/env node

import { program } from "commander";
import { Project } from "ts-morph";
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
  getTsFiles,
  weights,
} from "./functions/helper";

program
  .version("1.0.0")
  .description("Score TypeScript code for best practices and simplicity")
  .option("--json", "Output as JSON")
  .argument("<path>", "Path to TypeScript file or directory")
  .action((path, options) => {
    const project = new Project();
    const files = getTsFiles(resolve(path));
    const scores = files.map((file) => {
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
      const score = calculateScore(metrics);
      return {
        file,
        score,
        metrics,
        suggestions: generateSuggestions(metrics),
      };
    });
    console.log(
      options.json
        ? JSON.stringify(scores, null, 2)
        : formatHumanReadable(scores),
    );
  });

program.parse(process.argv);
