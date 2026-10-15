#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const ts_morph_1 = require("ts-morph");
const fs_1 = require("fs");
const path_1 = require("path");
const helper_1 = require("./functions/helper");
commander_1.program
    .version("1.0.0")
    .description("Score TypeScript code for best practices and simplicity")
    .option("--json", "Output as JSON")
    .argument("<path>", "Path to TypeScript file or directory")
    .action((path, options) => {
    const target = (0, path_1.resolve)(path);
    if (!(0, fs_1.existsSync)(target)) {
        commander_1.program.error(`path not found: ${path}`);
    }
    const project = new ts_morph_1.Project();
    const files = (0, helper_1.getTsFiles)(target);
    const scores = [];
    for (const file of files) {
        // One unreadable or pathological file must not abort the whole run
        try {
            const sourceFile = project.addSourceFileAtPath(file);
            const metrics = {
                avoidAny: (0, helper_1.calculateAvoidAny)(sourceFile),
                returnTypes: (0, helper_1.calculateReturnTypes)(sourceFile),
                accessModifiers: (0, helper_1.calculateAccessModifiers)(sourceFile),
                complexity: (0, helper_1.calculateComplexity)(sourceFile),
                nesting: (0, helper_1.calculateNesting)(sourceFile),
                preferConst: (0, helper_1.calculatePreferConst)(sourceFile),
                avoidAssertions: (0, helper_1.calculateAvoidAssertions)(sourceFile),
                useReadonly: (0, helper_1.calculateUseReadonly)(sourceFile),
                avoidVar: (0, helper_1.calculateAvoidVar)(sourceFile),
                optionalChaining: (0, helper_1.calculateOptionalChaining)(sourceFile),
            };
            scores.push({
                file,
                score: (0, helper_1.calculateScore)(metrics),
                metrics,
                suggestions: (0, helper_1.generateSuggestions)(metrics),
            });
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.error(`warning: could not score ${file}: ${reason}`);
            process.exitCode = 1;
        }
    }
    console.log(options.json
        ? JSON.stringify(scores, null, 2)
        : (0, helper_1.formatHumanReadable)(scores));
});
commander_1.program.parse(process.argv);
