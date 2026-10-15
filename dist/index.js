#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const ts_morph_1 = require("ts-morph");
const fs_1 = require("fs");
const path_1 = require("path");
const helper_1 = require("./functions/helper");
// Read at runtime so the reported version can never drift from package.json
function packageVersion() {
    try {
        const pkg = JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(__dirname, "..", "package.json"), "utf8"));
        return typeof pkg.version === "string" ? pkg.version : "unknown";
    }
    catch {
        return "unknown";
    }
}
function collect(value, previous) {
    return [...previous, value];
}
commander_1.program
    .version(packageVersion())
    .description("Score TypeScript code for best practices and simplicity")
    .option("--json", "Output as JSON")
    .option("-e, --exclude <name>", "Skip files or directories with this name (repeatable)", collect, [])
    .option("--min-score <n>", "Exit with code 1 if any file scores below n (0-100)")
    .argument("<path>", "Path to TypeScript file or directory")
    .action((path, options) => {
    const target = (0, path_1.resolve)(path);
    if (!(0, fs_1.existsSync)(target)) {
        commander_1.program.error(`path not found: ${path}`);
    }
    let minScore;
    if (options.minScore !== undefined) {
        minScore = Number(options.minScore);
        if (options.minScore.trim() === "" || !(minScore >= 0 && minScore <= 100)) {
            commander_1.program.error(`--min-score must be a number from 0 to 100`);
        }
    }
    const project = new ts_morph_1.Project();
    const files = (0, helper_1.getTsFiles)(target, options.exclude);
    if (files.length === 0) {
        console.error(`warning: no TypeScript files found in ${path}`);
        process.exitCode = 1;
    }
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
            const parseErrors = (0, helper_1.getSyntaxErrors)(sourceFile);
            if (parseErrors.length > 0) {
                console.error(`warning: ${file} has ${parseErrors.length} syntax error(s); scores may be unreliable`);
                process.exitCode = 1;
            }
            scores.push({
                file,
                score: (0, helper_1.calculateScore)(metrics),
                metrics,
                suggestions: (0, helper_1.generateSuggestions)(metrics),
                parseErrors,
            });
        }
        catch (error) {
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
    console.log(options.json
        ? JSON.stringify(scores, null, 2)
        : (0, helper_1.formatHumanReadable)(scores));
});
commander_1.program.parse(process.argv);
