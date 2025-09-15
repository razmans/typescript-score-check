#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var commander_1 = require("commander");
var ts_morph_1 = require("ts-morph");
var path_1 = require("path");
var helper_1 = require("./functions/helper");
commander_1.program
    .version("1.0.0")
    .description("Score TypeScript code for best practices and simplicity")
    .option("--json", "Output as JSON")
    .argument("<path>", "Path to TypeScript file or directory")
    .action(function (path, options) {
    var project = new ts_morph_1.Project();
    var files = (0, helper_1.getTsFiles)((0, path_1.resolve)(path));
    var scores = files.map(function (file) {
        var sourceFile = project.addSourceFileAtPath(file);
        var metrics = {
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
        var score = (0, helper_1.calculateScore)(metrics);
        return {
            file: file,
            score: score,
            metrics: metrics,
            suggestions: (0, helper_1.generateSuggestions)(metrics),
        };
    });
    console.log(options.json
        ? JSON.stringify(scores, null, 2)
        : (0, helper_1.formatHumanReadable)(scores));
});
commander_1.program.parse(process.argv);
