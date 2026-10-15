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
// ts-morph's getDescendants*/forEachDescendant recurse once per tree level and
// overflow the call stack on very deep trees (e.g. a chain of thousands of `+`).
// These helpers walk with an explicit stack in document order instead.
// `skip` stops the walk at a node: the node and its subtree are left out.
function descendants(root, skip) {
    const result = [];
    const stack = [];
    const pushChildren = (node) => {
        const children = [];
        node.forEachChild((child) => {
            children.push(child);
        });
        for (let i = children.length - 1; i >= 0; i--)
            stack.push(children[i]);
    };
    pushChildren(root);
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (skip?.(node))
            continue;
        result.push(node);
        pushChildren(node);
    }
    return result;
}
function descendantsOfKind(root, kind) {
    return descendants(root).filter((node) => node.getKind() === kind);
}
function isTsFile(path) {
    return path.endsWith(".ts");
}
function errorCode(error) {
    if (error instanceof Error && "code" in error)
        return String(error.code);
    return "unknown error";
}
// Get all TypeScript files under a path, recursively. Real directories are
// followed; symlinked directories are skipped (no loops) and broken symlinks or
// unreadable directories are skipped with a warning on stderr instead of
// aborting the whole run. Results are sorted for deterministic output.
function getTsFiles(path) {
    const stats = (0, fs_1.statSync)(path);
    if (!stats.isDirectory()) {
        // It's a file, return directly
        return isTsFile(path) ? [path] : [];
    }
    const files = [];
    for (const entry of (0, fs_1.readdirSync)(path, { withFileTypes: true })) {
        const full = (0, path_1.join)(path, entry.name);
        try {
            if (entry.isDirectory()) {
                files.push(...getTsFiles(full));
            }
            else if (entry.isSymbolicLink()) {
                // Follow symlinks to files only, never to directories
                if ((0, fs_1.statSync)(full).isFile() && isTsFile(full))
                    files.push(full);
            }
            else if (entry.isFile() && isTsFile(full)) {
                files.push(full);
            }
        }
        catch (error) {
            console.error(`warning: skipped ${full} (${errorCode(error)})`);
        }
    }
    return files.sort();
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
    for (const node of descendants(sourceFile)) {
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
function isFunctionLike(node) {
    return (ts_morph_1.Node.isFunctionDeclaration(node) ||
        ts_morph_1.Node.isMethodDeclaration(node) ||
        ts_morph_1.Node.isConstructorDeclaration(node) ||
        ts_morph_1.Node.isGetAccessorDeclaration(node) ||
        ts_morph_1.Node.isSetAccessorDeclaration(node) ||
        ts_morph_1.Node.isArrowFunction(node) ||
        ts_morph_1.Node.isFunctionExpression(node));
}
// `const f = () => {}`, `{ f: () => {} }`, `class A { f = () => {} }`, `x = () => {}`
function isAssignedFunction(fn) {
    let child = fn;
    let parent = fn.getParent();
    while (parent && ts_morph_1.Node.isParenthesizedExpression(parent)) {
        child = parent;
        parent = parent.getParent();
    }
    if (!parent)
        return false;
    if (ts_morph_1.Node.isVariableDeclaration(parent) ||
        ts_morph_1.Node.isPropertyDeclaration(parent) ||
        ts_morph_1.Node.isPropertyAssignment(parent)) {
        return parent.getInitializer() === child;
    }
    return (ts_morph_1.Node.isBinaryExpression(parent) &&
        parent.getOperatorToken().getText() === "=" &&
        parent.getRight() === child);
}
// A unit is a function that is scored on its own: declarations, methods,
// constructors, accessors and functions assigned to a name. Inline callbacks
// (`arr.map(x => ...)`) belong to the enclosing unit; a callback with no
// enclosing function is its own unit.
function isFunctionUnit(fn) {
    if (!fn.getBody())
        return false; // overload signatures, abstract methods
    if (!ts_morph_1.Node.isArrowFunction(fn) && !ts_morph_1.Node.isFunctionExpression(fn))
        return true;
    if (isAssignedFunction(fn))
        return true;
    return !fn.getFirstAncestor(isFunctionLike);
}
function getFunctionUnits(sourceFile) {
    return descendants(sourceFile)
        .filter(isFunctionLike)
        .filter(isFunctionUnit);
}
// Explicit return types are expected on declarations, methods and getters, and
// on functions assigned to an untyped name. Constructors, setters, inline
// callbacks and contextually typed functions are exempt.
function requiresReturnType(fn) {
    if (ts_morph_1.Node.isConstructorDeclaration(fn) || ts_morph_1.Node.isSetAccessorDeclaration(fn)) {
        return false;
    }
    if (!ts_morph_1.Node.isArrowFunction(fn) && !ts_morph_1.Node.isFunctionExpression(fn))
        return true;
    if (!isAssignedFunction(fn))
        return false;
    const parent = fn.getParent();
    const owner = ts_morph_1.Node.isParenthesizedExpression(parent)
        ? parent.getParent()
        : parent;
    const isContextuallyTyped = (ts_morph_1.Node.isVariableDeclaration(owner) || ts_morph_1.Node.isPropertyDeclaration(owner)) &&
        owner.getTypeNode() !== undefined;
    return !isContextuallyTyped;
}
function calculateReturnTypes(sourceFile) {
    const functions = getFunctionUnits(sourceFile).filter(requiresReturnType);
    if (functions.length === 0)
        return null;
    const withReturn = functions.filter((f) => ts_morph_1.Node.isReturnTyped(f) && f.getReturnTypeNode() !== undefined).length;
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
// Descendants of a unit, excluding the bodies of nested units (those are
// scored on their own). Inline callbacks are included.
function getOwnDescendants(unit) {
    return descendants(unit, (node) => isFunctionLike(node) && isFunctionUnit(node));
}
const DECISION_KINDS = new Set([
    ts_morph_1.SyntaxKind.IfStatement,
    ts_morph_1.SyntaxKind.SwitchStatement,
    ts_morph_1.SyntaxKind.ForStatement,
    ts_morph_1.SyntaxKind.ForInStatement,
    ts_morph_1.SyntaxKind.ForOfStatement,
    ts_morph_1.SyntaxKind.WhileStatement,
    ts_morph_1.SyntaxKind.DoStatement,
    // `try` is not a branch; only the `catch` adds a path
    ts_morph_1.SyntaxKind.CatchClause,
    ts_morph_1.SyntaxKind.ConditionalExpression,
]);
function isLogicalAndOr(node) {
    if (!ts_morph_1.Node.isBinaryExpression(node))
        return false;
    const operator = node.getOperatorToken().getKind();
    return (operator === ts_morph_1.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts_morph_1.SyntaxKind.BarBarToken);
}
function calculateComplexity(sourceFile) {
    const units = getFunctionUnits(sourceFile);
    if (units.length === 0)
        return null;
    let totalComplexity = 0;
    for (const unit of units) {
        let complexity = 1;
        for (const node of getOwnDescendants(unit)) {
            if (DECISION_KINDS.has(node.getKind()) || isLogicalAndOr(node)) {
                complexity++;
            }
        }
        totalComplexity += complexity;
    }
    const avgComplexity = totalComplexity / units.length;
    return Math.max(0, 1 - (avgComplexity - 1) / 5); // Lowered threshold to 6 for more sensitivity
}
const NESTING_KINDS = new Set([
    ts_morph_1.SyntaxKind.IfStatement,
    ts_morph_1.SyntaxKind.SwitchStatement,
    ts_morph_1.SyntaxKind.ForStatement,
    ts_morph_1.SyntaxKind.ForInStatement,
    ts_morph_1.SyntaxKind.ForOfStatement,
    ts_morph_1.SyntaxKind.WhileStatement,
    ts_morph_1.SyntaxKind.DoStatement,
]);
// `else if` is flat control flow, not a deeper level of nesting
function isElseIf(node, parent) {
    return (ts_morph_1.Node.isIfStatement(node) &&
        ts_morph_1.Node.isIfStatement(parent) &&
        parent.getElseStatement() === node);
}
// Iterative (explicit stack) so very deep trees, such as a very long chain of
// binary expressions, cannot overflow the call stack.
function getNesting(root) {
    let maxDepth = 0;
    const stack = [{ node: root, depth: 0 }];
    for (let item = stack.pop(); item; item = stack.pop()) {
        const { node, depth } = item;
        maxDepth = Math.max(maxDepth, depth);
        node.forEachChild((child) => {
            // nested units are scored on their own
            if (isFunctionLike(child) && isFunctionUnit(child))
                return;
            const increases = NESTING_KINDS.has(child.getKind()) && !isElseIf(child, node);
            stack.push({ node: child, depth: increases ? depth + 1 : depth });
        });
    }
    return maxDepth;
}
function calculateNesting(sourceFile) {
    const units = getFunctionUnits(sourceFile);
    if (units.length === 0)
        return null;
    const maxNesting = Math.max(...units.map((unit) => getNesting(unit)));
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
    return descendantsOfKind(name, ts_morph_1.SyntaxKind.BindingElement)
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
// Every identifier that is written to (assignment, ++/--, destructuring
// assignment, loop variable), grouped by name. Computed once per file so each
// `let` is a map lookup instead of a scan of its whole scope.
function collectWriteReferences(sourceFile) {
    const writes = new Map();
    for (const id of descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.Identifier)) {
        if (!isWriteReference(id))
            continue;
        const name = id.getText();
        const existing = writes.get(name);
        if (existing)
            existing.push(id);
        else
            writes.set(name, [id]);
    }
    return writes;
}
// A `let` is justified if it is reassigned anywhere in its scope (counters,
// accumulators, `i++` loops, destructuring assignment) or is declared without
// an initializer (deferred assignment). Name matching is syntactic, so a
// shadowing variable's writes can make this lenient, never stricter.
function needsLet(declaration, writes) {
    const loopStatement = declaration.getParent()?.getParent();
    const isLoopVariable = !!loopStatement &&
        (ts_morph_1.Node.isForInStatement(loopStatement) ||
            ts_morph_1.Node.isForOfStatement(loopStatement));
    if (!declaration.getInitializer() && !isLoopVariable)
        return true;
    const scope = letScope(declaration);
    const scopeStart = scope.getPos();
    const scopeEnd = scope.getEnd();
    return bindingIdentifiers(declaration).some((binding) => (writes.get(binding.getText()) ?? []).some((id) => id.getPos() >= scopeStart && id.getEnd() <= scopeEnd));
}
function calculatePreferConst(sourceFile) {
    const declarations = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.VariableDeclaration).filter((v) => v.getParent().getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList);
    const lets = declarations.filter((v) => v.getParent().getFlags() & ts_morph_1.ts.NodeFlags.Let);
    const consts = declarations.filter((v) => v.getParent().getFlags() & ts_morph_1.ts.NodeFlags.Const);
    const total = lets.length + consts.length;
    if (total === 0)
        return null;
    const writes = lets.length > 0 ? collectWriteReferences(sourceFile) : new Map();
    const unnecessaryLets = lets.filter((v) => !needsLet(v, writes)).length;
    return 1 - unnecessaryLets / total;
}
function calculateAvoidAssertions(sourceFile) {
    const asNodes = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.AsExpression);
    // `as const` is a safe literal narrowing, not an unsafe type assertion
    const asAssertions = asNodes.filter((n) => n.getTypeNode()?.getText() !== "const").length;
    const angleBracketAssertions = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.TypeAssertionExpression).length;
    const nonNullAssertions = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.NonNullExpression).length;
    const assertions = asAssertions + angleBracketAssertions + nonNullAssertions;
    // Every assertion kind is also part of the denominator, so the ratio can
    // never exceed 1. Calls and binary expressions are a proxy for "other code".
    const callExpressions = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.CallExpression).length;
    const binaryExpressions = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.BinaryExpression).length;
    const totalExpressions = asNodes.length +
        angleBracketAssertions +
        nonNullAssertions +
        callExpressions +
        binaryExpressions;
    if (totalExpressions === 0)
        return null;
    return Math.max(0, 1 - assertions / totalExpressions);
}
function calculateUseReadonly(sourceFile) {
    const properties = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.PropertyDeclaration);
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
// `using` / `await using` declarations are block scoped too, not `var`
const BLOCK_SCOPED_FLAGS = ts_morph_1.ts.NodeFlags.Let | ts_morph_1.ts.NodeFlags.Const | ts_morph_1.ts.NodeFlags.Using;
function calculateAvoidVar(sourceFile) {
    const declarations = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.VariableDeclaration);
    if (declarations.length === 0)
        return null;
    return declarations
        .some((v) => v.getParent().getKind() === ts_morph_1.SyntaxKind.VariableDeclarationList &&
        !(v.getParent().getFlags() & BLOCK_SCOPED_FLAGS))
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
    const manualNullChecks = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.BinaryExpression)
        .filter(isManualAndGuard).length +
        descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.ConditionalExpression)
            .filter(isManualTernaryGuard).length;
    const modernOperators = descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.QuestionDotToken).length +
        descendantsOfKind(sourceFile, ts_morph_1.SyntaxKind.QuestionQuestionToken).length;
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
