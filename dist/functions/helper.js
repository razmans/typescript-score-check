"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weights = void 0;
exports.getTsFiles = getTsFiles;
exports.formatHumanReadable = formatHumanReadable;
exports.generateSuggestions = generateSuggestions;
exports.calculateAvoidAny = calculateAvoidAny;
exports.calculateReturnTypes = calculateReturnTypes;
exports.calculateAccessModifiers = calculateAccessModifiers;
exports.calculateComplexity = calculateComplexity;
exports.calculateNesting = calculateNesting;
exports.calculatePreferConst = calculatePreferConst;
exports.calculateAvoidAssertions = calculateAvoidAssertions;
exports.calculateUseReadonly = calculateUseReadonly;
exports.calculateAvoidVar = calculateAvoidVar;
exports.calculateOptionalChaining = calculateOptionalChaining;
exports.calculateScore = calculateScore;
const path_1 = require("path");
const fs_1 = require("fs");
const ts_morph_1 = require("ts-morph");
// Get all TypeScript files in a directory recursively
function getTsFiles(dir) {
    const files = [];
    for (const file of (0, fs_1.readdirSync)(dir)) {
        const fullPath = (0, path_1.resolve)(dir, file);
        if ((0, fs_1.statSync)(fullPath).isDirectory()) {
            files.push(...getTsFiles(fullPath));
        }
        else if ((0, path_1.extname)(fullPath) === ".ts" || (0, path_1.extname)(fullPath) === ".tsx") {
            files.push(fullPath);
        }
    }
    return files;
}
function formatHumanReadable(scores) {
    return scores
        .map((s) => `\nFILE: ${s.file}\n\nSCORE: ${s.score.toFixed(2)}/100\n\n${Object.entries(s.metrics)
        .map(([k, v]) => `${k}: ${(v * 100).toFixed(2)}%`)
        .join("\n")}\n\n${s.suggestions.length > 0
        ? `SUGGESTIONS:\n${s.suggestions.join("\n")}`
        : "No suggestions, great job!"}`)
        .join("\n\n");
}
function generateSuggestions(metrics) {
    const suggestions = [];
    if (metrics.avoidAny < 1)
        suggestions.push("Replace `any` with specific types or `unknown`.");
    if (metrics.returnTypes < 1)
        suggestions.push("Add explicit return types to functions.");
    if (metrics.accessModifiers < 1)
        suggestions.push("Add access modifiers (public/private) to class members.");
    if (metrics.complexity < 1)
        suggestions.push("Simplify functions with high complexity by extracting logic.");
    if (metrics.nesting < 1)
        suggestions.push("Reduce nesting with early returns or function extraction.");
    if (metrics.preferConst < 1)
        suggestions.push("Use `const` instead of `let` for non-reassigned variables.");
    if (metrics.avoidAssertions < 1)
        suggestions.push("Replace type assertions with type guards.");
    if (metrics.useReadonly < 1)
        suggestions.push("Mark immutable properties as `readonly`.");
    if (metrics.avoidVar < 1)
        suggestions.push("Replace `var` with `let` or `const`.");
    if (metrics.optionalChaining < 1)
        suggestions.push("Use optional chaining (`?.`) and nullish coalescing (`??`) for null checks.");
    return suggestions;
}
exports.weights = {
    avoidAny: 10,
    returnTypes: 10,
    accessModifiers: 10,
    complexity: 10,
    nesting: 10,
    preferConst: 10,
    avoidAssertions: 10,
    useReadonly: 10,
    avoidVar: 10,
    optionalChaining: 10,
};
function calculateAvoidAny(sourceFile) {
    const anyCount = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.AnyKeyword).length;
    const typeRefCount = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.TypeReference).length;
    // Use total type nodes as denominator, fallback to total nodes if 0
    const denominator = typeRefCount > 0 ? typeRefCount : anyCount > 0 ? anyCount : 1;
    return 1 - anyCount / denominator;
}
function calculateReturnTypes(sourceFile) {
    const functions = sourceFile.getFunctions();
    if (functions.length === 0)
        return 1;
    const withReturn = functions.filter((f) => f.getReturnTypeNode()).length;
    return withReturn / functions.length;
}
function calculateAccessModifiers(sourceFile) {
    const classes = sourceFile.getClasses();
    if (classes.length === 0)
        return 1;
    let members = 0;
    let withModifiers = 0;
    classes.forEach((cls) => {
        cls.getMembers().forEach((member) => {
            members++;
            // Only count members that have getModifiers (not static blocks)
            if (typeof member.getModifiers === "function" &&
                member.getModifiers().length > 0) {
                withModifiers++;
            }
        });
    });
    return members === 0 ? 1 : withModifiers / members;
}
function calculateComplexity(sourceFile) {
    const functions = sourceFile.getFunctions();
    if (functions.length === 0)
        return 1;
    let totalComplexity = 0;
    functions.forEach((f) => {
        let complexity = 1;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.IfStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.SwitchStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.ForStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.ForInStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.ForOfStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.WhileStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.DoStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.TryStatement).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.CatchClause).length;
        complexity += f.getDescendantsOfKind(ts_morph_1.SyntaxKind.ConditionalExpression).length;
        complexity += f
            .getDescendantsOfKind(ts_morph_1.SyntaxKind.BinaryExpression)
            .filter((expr) => typeof expr.getOperatorToken === "function" &&
            expr.getOperatorToken().getKind() ===
                ts_morph_1.SyntaxKind.AmpersandAmpersandToken).length;
        complexity += f
            .getDescendantsOfKind(ts_morph_1.SyntaxKind.BinaryExpression)
            .filter((expr) => typeof expr.getOperatorToken === "function" &&
            expr.getOperatorToken().getKind() === ts_morph_1.SyntaxKind.BarBarToken).length;
        totalComplexity += complexity;
    });
    const avgComplexity = totalComplexity / functions.length;
    return Math.max(0, 1 - (avgComplexity - 1) / 5); // Lowered threshold to 6 for more sensitivity
}
function calculateNesting(sourceFile) {
    const functions = sourceFile.getFunctions();
    if (functions.length === 0)
        return 1;
    let maxNesting = 0;
    function getNesting(node, current = 0) {
        let localMax = current;
        node.forEachChild((child) => {
            if ([
                ts_morph_1.SyntaxKind.IfStatement,
                ts_morph_1.SyntaxKind.SwitchStatement,
                ts_morph_1.SyntaxKind.ForStatement,
                ts_morph_1.SyntaxKind.ForInStatement,
                ts_morph_1.SyntaxKind.ForOfStatement,
                ts_morph_1.SyntaxKind.WhileStatement,
                ts_morph_1.SyntaxKind.DoStatement,
            ].includes(child.getKind())) {
                localMax = Math.max(localMax, getNesting(child, current + 1));
            }
            else {
                localMax = Math.max(localMax, getNesting(child, current));
            }
        });
        return localMax;
    }
    functions.forEach((f) => {
        maxNesting = Math.max(maxNesting, getNesting(f));
    });
    return Math.max(0, 1 - maxNesting / 4);
}
function calculatePreferConst(sourceFile) {
    const lets = sourceFile
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration)
        .filter((v) => v.getParent().getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList &&
        v.getParent().getFlags() & ts_morph_1.ts.NodeFlags.Let);
    const consts = sourceFile
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration)
        .filter((v) => v.getParent().getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList &&
        v.getParent().getFlags() & ts_morph_1.ts.NodeFlags.Const);
    const total = lets.length + consts.length;
    return total === 0 ? 1 : consts.length / total;
}
function calculateAvoidAssertions(sourceFile) {
    const assertions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.TypeAssertionExpression).length +
        sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.NonNullExpression).length;
    // Use a sum of common expression kinds as a proxy for total expressions
    const asExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.AsExpression).length;
    const callExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression).length;
    const binaryExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.BinaryExpression).length;
    const totalExpressions = asExpressions + callExpressions + binaryExpressions || 1;
    return 1 - assertions / totalExpressions;
}
function calculateUseReadonly(sourceFile) {
    const properties = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.PropertyDeclaration);
    if (properties.length === 0)
        return 1;
    // Only PropertyDeclaration nodes have getStructure().isReadonly
    const readonlyCount = properties.filter((p) => {
        // Defensive: check getStructure exists and isReadonly is true
        return (typeof p.getStructure === "function" &&
            p.getStructure().isReadonly === true);
    }).length;
    return readonlyCount / properties.length;
}
function calculateAvoidVar(sourceFile) {
    return sourceFile
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration)
        .some((v) => v.getParent().getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList &&
        !(v.getParent().getFlags() & (ts_morph_1.ts.NodeFlags.Let | ts_morph_1.ts.NodeFlags.Const)))
        ? 0
        : 1;
}
function calculateOptionalChaining(sourceFile) {
    // Improved: Check for patterns like x && x.y (manual) vs x?.y (modern)
    let manualNullChecks = 0;
    let modernOperators = 0;
    sourceFile
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.BinaryExpression)
        .forEach((e) => {
        if (typeof e.getOperatorToken === "function" &&
            e.getOperatorToken().getKind() ===
                ts_morph_1.SyntaxKind.AmpersandAmpersandToken) {
            manualNullChecks++;
        }
    });
    modernOperators += sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.QuestionDotToken).length;
    modernOperators += sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.QuestionQuestionToken).length;
    const totalNullChecks = manualNullChecks + modernOperators || 1;
    return modernOperators / totalNullChecks;
    // Removed stray closing brace at end of file
}
function calculateScore(metrics) {
    // Only use metrics that have a defined weight
    const weightedSum = Object.entries(metrics).reduce((sum, [key, value]) => exports.weights[key] !== undefined ? sum + exports.weights[key] * value : sum, 0);
    const totalWeight = Object.keys(exports.weights).reduce((sum, k) => sum + exports.weights[k], 0);
    return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
}
