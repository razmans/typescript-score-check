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
    const stats = (0, fs_1.statSync)(dir);
    if (!stats.isDirectory()) {
        // It's a file, return directly
        return dir.endsWith(".ts") ? [dir] : [];
    }
    return (0, fs_1.readdirSync)(dir)
        .map((f) => (0, path_1.join)(dir, f))
        .flatMap((f) => {
        const s = (0, fs_1.statSync)(f);
        if (s.isDirectory())
            return getTsFiles(f);
        return f.endsWith(".ts") ? [f] : [];
    });
}
function formatPercent(value) {
    return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}
function formatHumanReadable(scores) {
    return scores
        .map((s) => `\nFILE: ${s.file}\n\nSCORE: ${s.score === null ? "n/a" : `${s.score.toFixed(2)}/100`}\n\n${Object.entries(s.metrics)
        .map(([k, v]) => `${k}: ${formatPercent(v)}`)
        .join("\n")}\n\n${s.suggestions.length > 0
        ? `SUGGESTIONS:\n${s.suggestions.join("\n")}`
        : "No suggestions, great job!"}`)
        .join("\n\n");
}
function isImperfect(value) {
    return value !== null && value !== undefined && value < 1;
}
function generateSuggestions(metrics) {
    const suggestions = [];
    if (isImperfect(metrics.avoidAny))
        suggestions.push("Replace `any` with specific types or `unknown`.");
    if (isImperfect(metrics.returnTypes))
        suggestions.push("Add explicit return types to functions.");
    if (isImperfect(metrics.accessModifiers))
        suggestions.push("Add access modifiers (public/private) to class members.");
    if (isImperfect(metrics.complexity))
        suggestions.push("Simplify functions with high complexity by extracting logic.");
    if (isImperfect(metrics.nesting))
        suggestions.push("Reduce nesting with early returns or function extraction.");
    if (isImperfect(metrics.preferConst))
        suggestions.push("Use `const` instead of `let` for non-reassigned variables.");
    if (isImperfect(metrics.avoidAssertions))
        suggestions.push("Replace type assertions with type guards.");
    if (isImperfect(metrics.useReadonly))
        suggestions.push("Mark immutable properties as `readonly`.");
    if (isImperfect(metrics.avoidVar))
        suggestions.push("Replace `var` with `let` or `const`.");
    if (isImperfect(metrics.optionalChaining))
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
// Atomic type nodes: the leaves of a type annotation (keyword types, named type
// references and literal types). Used as a stable denominator for avoidAny so
// the score is the share of type positions that are `any`.
const ATOMIC_TYPE_KINDS = new Set([
    ts_morph_1.SyntaxKind.AnyKeyword,
    ts_morph_1.SyntaxKind.UnknownKeyword,
    ts_morph_1.SyntaxKind.StringKeyword,
    ts_morph_1.SyntaxKind.NumberKeyword,
    ts_morph_1.SyntaxKind.BooleanKeyword,
    ts_morph_1.SyntaxKind.BigIntKeyword,
    ts_morph_1.SyntaxKind.SymbolKeyword,
    ts_morph_1.SyntaxKind.ObjectKeyword,
    ts_morph_1.SyntaxKind.VoidKeyword,
    ts_morph_1.SyntaxKind.NeverKeyword,
    ts_morph_1.SyntaxKind.UndefinedKeyword,
    ts_morph_1.SyntaxKind.TypeReference,
    ts_morph_1.SyntaxKind.LiteralType,
]);
function calculateAvoidAny(sourceFile) {
    let anyCount = 0;
    let atomicTypeCount = 0;
    for (const node of sourceFile.getDescendants()) {
        const kind = node.getKind();
        if (!ATOMIC_TYPE_KINDS.has(kind))
            continue;
        // `void expr` also contains a VoidKeyword token; it is not a type
        if (kind === ts_morph_1.SyntaxKind.VoidKeyword &&
            node.getParent()?.getKind() === ts_morph_1.SyntaxKind.VoidExpression) {
            continue;
        }
        atomicTypeCount++;
        if (kind === ts_morph_1.SyntaxKind.AnyKeyword)
            anyCount++;
    }
    if (atomicTypeCount === 0)
        return null;
    return 1 - anyCount / atomicTypeCount;
}
function calculateReturnTypes(sourceFile) {
    const functions = sourceFile.getFunctions();
    if (functions.length === 0)
        return null;
    const withReturn = functions.filter((f) => f.getReturnTypeNode()).length;
    return withReturn / functions.length;
}
function calculateAccessModifiers(sourceFile) {
    const classes = sourceFile.getClasses();
    if (classes.length === 0)
        return null;
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
    return members === 0 ? null : withModifiers / members;
}
function calculateComplexity(sourceFile) {
    const functions = sourceFile.getFunctions();
    if (functions.length === 0)
        return null;
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
        return null;
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
const ASSIGNMENT_OPERATORS = new Set([
    "=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "**=",
    "<<=",
    ">>=",
    ">>>=",
    "&=",
    "|=",
    "^=",
    "&&=",
    "||=",
    "??=",
]);
function isLoopInitializer(node, parent) {
    return ((ts_morph_1.Node.isForOfStatement(parent) || ts_morph_1.Node.isForInStatement(parent)) &&
        parent.getInitializer() === node);
}
// `[a, b] = [b, a]`, `({ a } = obj)`, `for ([a, b] of pairs)`
function isDestructuringAssignmentTarget(id) {
    let node = id;
    let parent = node.getParent();
    while (parent) {
        if (ts_morph_1.Node.isArrayLiteralExpression(parent) ||
            ts_morph_1.Node.isObjectLiteralExpression(parent) ||
            ts_morph_1.Node.isSpreadElement(parent) ||
            ts_morph_1.Node.isSpreadAssignment(parent) ||
            ts_morph_1.Node.isShorthandPropertyAssignment(parent) ||
            ts_morph_1.Node.isParenthesizedExpression(parent) ||
            (ts_morph_1.Node.isPropertyAssignment(parent) && parent.getInitializer() === node)) {
            node = parent;
            parent = node.getParent();
            continue;
        }
        if (node === id)
            return false;
        if (ts_morph_1.Node.isBinaryExpression(parent) &&
            parent.getOperatorToken().getText() === "=" &&
            parent.getLeft() === node) {
            return true;
        }
        return isLoopInitializer(node, parent);
    }
    return false;
}
function isWriteReference(id) {
    const parent = id.getParent();
    if (!parent)
        return false;
    if (ts_morph_1.Node.isBinaryExpression(parent) && parent.getLeft() === id) {
        return ASSIGNMENT_OPERATORS.has(parent.getOperatorToken().getText());
    }
    if ((ts_morph_1.Node.isPrefixUnaryExpression(parent) ||
        ts_morph_1.Node.isPostfixUnaryExpression(parent)) &&
        parent.getOperand() === id) {
        const operator = parent.getOperatorToken();
        return (operator === ts_morph_1.SyntaxKind.PlusPlusToken ||
            operator === ts_morph_1.SyntaxKind.MinusMinusToken);
    }
    if (isLoopInitializer(id, parent))
        return true;
    return isDestructuringAssignmentTarget(id);
}
function bindingIdentifiers(declaration) {
    const name = declaration.getNameNode();
    if (ts_morph_1.Node.isIdentifier(name))
        return [name];
    return name
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.BindingElement)
        .map((element) => element.getNameNode())
        .filter((n) => ts_morph_1.Node.isIdentifier(n));
}
// The region in which a `let` is visible and may be reassigned
function letScope(declaration) {
    const statement = declaration.getParent()?.getParent();
    if (statement &&
        (ts_morph_1.Node.isForStatement(statement) ||
            ts_morph_1.Node.isForInStatement(statement) ||
            ts_morph_1.Node.isForOfStatement(statement))) {
        return statement;
    }
    return (declaration.getFirstAncestor((a) => ts_morph_1.Node.isBlock(a) ||
        ts_morph_1.Node.isModuleBlock(a) ||
        ts_morph_1.Node.isCaseBlock(a) ||
        ts_morph_1.Node.isSourceFile(a)) ?? declaration.getSourceFile());
}
// A `let` is justified if it is reassigned anywhere in its scope (counters,
// accumulators, `i++` loops, destructuring assignment) or is declared without
// an initializer (deferred assignment). Name matching is syntactic, so a
// shadowing variable's writes can make this lenient, never stricter.
function needsLet(declaration) {
    const loopStatement = declaration.getParent()?.getParent();
    const isLoopVariable = !!loopStatement &&
        (ts_morph_1.Node.isForInStatement(loopStatement) ||
            ts_morph_1.Node.isForOfStatement(loopStatement));
    if (!declaration.getInitializer() && !isLoopVariable)
        return true;
    const names = new Set(bindingIdentifiers(declaration).map((i) => i.getText()));
    return letScope(declaration)
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.Identifier)
        .some((id) => names.has(id.getText()) && isWriteReference(id));
}
function calculatePreferConst(sourceFile) {
    const declarations = sourceFile
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration)
        .filter((v) => {
        const list = v.getParent();
        return list.getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList;
    });
    const lets = declarations.filter((v) => v.getParent().getFlags() & ts_morph_1.ts.NodeFlags.Let);
    const consts = declarations.filter((v) => v.getParent().getFlags() & ts_morph_1.ts.NodeFlags.Const);
    const total = lets.length + consts.length;
    if (total === 0)
        return null;
    const unnecessaryLets = lets.filter((v) => !needsLet(v)).length;
    return 1 - unnecessaryLets / total;
}
function calculateAvoidAssertions(sourceFile) {
    const asNodes = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.AsExpression);
    // `as const` is a safe literal narrowing, not an unsafe type assertion
    const asAssertions = asNodes.filter((n) => n.getTypeNode()?.getText() !== "const").length;
    const assertions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.TypeAssertionExpression).length +
        sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.NonNullExpression).length +
        asAssertions;
    // Use a sum of common expression kinds as a proxy for total expressions
    const asExpressions = asNodes.length;
    const callExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CallExpression).length;
    const binaryExpressions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.BinaryExpression).length;
    const totalExpressions = asExpressions + callExpressions + binaryExpressions;
    if (totalExpressions === 0)
        return null;
    return 1 - assertions / totalExpressions;
}
function calculateUseReadonly(sourceFile) {
    const properties = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.PropertyDeclaration);
    if (properties.length === 0)
        return null;
    // Only PropertyDeclaration nodes have getStructure().isReadonly
    const readonlyCount = properties.filter((p) => {
        // Defensive: check getStructure exists and isReadonly is true
        return (typeof p.getStructure === "function" &&
            p.getStructure().isReadonly === true);
    }).length;
    return readonlyCount / properties.length;
}
function calculateAvoidVar(sourceFile) {
    const declarations = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration);
    if (declarations.length === 0)
        return null;
    return declarations
        .some((v) => v.getParent().getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList &&
        !(v.getParent().getFlags() & (ts_morph_1.ts.NodeFlags.Let | ts_morph_1.ts.NodeFlags.Const)))
        ? 0
        : 1;
}
function stripWrappers(node) {
    let current = node;
    while (ts_morph_1.Node.isParenthesizedExpression(current) ||
        ts_morph_1.Node.isNonNullExpression(current)) {
        current = current.getExpression();
    }
    return current;
}
function normalisedText(node) {
    return stripWrappers(node).getText().replace(/\s+/g, "");
}
// Receivers along an access chain: for `a.b.c()` this is ["a.b.c", "a.b", "a"].
// A null check on any of these could be replaced by `?.`.
function accessChainReceivers(node) {
    const receivers = [];
    let current = stripWrappers(node);
    while (ts_morph_1.Node.isPropertyAccessExpression(current) ||
        ts_morph_1.Node.isElementAccessExpression(current) ||
        ts_morph_1.Node.isCallExpression(current)) {
        current = stripWrappers(current.getExpression());
        receivers.push(normalisedText(current));
    }
    return receivers;
}
function isNullish(node) {
    const n = stripWrappers(node);
    return (ts_morph_1.Node.isNullLiteral(n) || (ts_morph_1.Node.isIdentifier(n) && n.getText() === "undefined"));
}
// Recognise `x`, `!!x`, `!x`, `x != null`, `x !== undefined`, `x == null`, ...
function parseNullGuard(node) {
    const n = stripWrappers(node);
    if (ts_morph_1.Node.isPrefixUnaryExpression(n)) {
        if (n.getOperatorToken() !== ts_morph_1.SyntaxKind.ExclamationToken)
            return undefined;
        const operand = stripWrappers(n.getOperand());
        if (ts_morph_1.Node.isPrefixUnaryExpression(operand) &&
            operand.getOperatorToken() === ts_morph_1.SyntaxKind.ExclamationToken) {
            return {
                target: normalisedText(operand.getOperand()),
                presentWhenTrue: true,
            };
        }
        return { target: normalisedText(operand), presentWhenTrue: false };
    }
    if (ts_morph_1.Node.isBinaryExpression(n)) {
        const operator = n.getOperatorToken().getText();
        const isNotEqual = operator === "!=" || operator === "!==";
        const isEqual = operator === "==" || operator === "===";
        if (!isNotEqual && !isEqual)
            return undefined;
        const left = n.getLeft();
        const right = n.getRight();
        if (isNullish(right)) {
            return { target: normalisedText(left), presentWhenTrue: isNotEqual };
        }
        if (isNullish(left)) {
            return { target: normalisedText(right), presentWhenTrue: isNotEqual };
        }
        return undefined;
    }
    if (ts_morph_1.Node.isIdentifier(n) ||
        ts_morph_1.Node.isPropertyAccessExpression(n) ||
        ts_morph_1.Node.isElementAccessExpression(n)) {
        return { target: normalisedText(n), presentWhenTrue: true };
    }
    return undefined;
}
function isAndExpression(node) {
    return (ts_morph_1.Node.isBinaryExpression(node) &&
        node.getOperatorToken().getKind() === ts_morph_1.SyntaxKind.AmpersandAmpersandToken);
}
// `x && x.y`, `x && x.y.z()`, `a && a.b && a.b.c`
function isManualAndGuard(expr) {
    let guardNode = stripWrappers(expr.getLeft());
    while (isAndExpression(guardNode)) {
        guardNode = stripWrappers(guardNode.getRight());
    }
    const guard = parseNullGuard(guardNode);
    if (!guard || !guard.presentWhenTrue)
        return false;
    return accessChainReceivers(expr.getRight()).includes(guard.target);
}
// `x ? x.y : d`, `x != null ? x.y : d`, `x == null ? d : x.y`
function isManualTernaryGuard(expr) {
    const guard = parseNullGuard(expr.getCondition());
    if (!guard)
        return false;
    const guarded = guard.presentWhenTrue ? expr.getWhenTrue() : expr.getWhenFalse();
    return accessChainReceivers(guarded).includes(guard.target);
}
function calculateOptionalChaining(sourceFile) {
    // Manual null-check patterns (`x && x.y`, `x ? x.y : d`) vs modern operators
    // (`?.`, `??`). Plain boolean logic such as `a > 1 && b < 2` is not counted.
    const manualNullChecks = sourceFile
        .getDescendantsOfKind(ts_morph_1.SyntaxKind.BinaryExpression)
        .filter(isManualAndGuard).length +
        sourceFile
            .getDescendantsOfKind(ts_morph_1.SyntaxKind.ConditionalExpression)
            .filter(isManualTernaryGuard).length;
    const modernOperators = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.QuestionDotToken).length +
        sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.QuestionQuestionToken).length;
    const totalNullChecks = manualNullChecks + modernOperators;
    if (totalNullChecks === 0)
        return null;
    return modernOperators / totalNullChecks;
}
function calculateScore(metrics) {
    // Only metrics that have a defined weight and applied to this file count;
    // weights are re-normalised over the applicable metrics.
    let weightedSum = 0;
    let totalWeight = 0;
    for (const [key, value] of Object.entries(metrics)) {
        const weight = exports.weights[key];
        if (weight === undefined || value === null)
            continue;
        weightedSum += weight * value;
        totalWeight += weight;
    }
    return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : null;
}
