import { extname, join, resolve } from "path";
import { readdirSync, statSync } from "fs";
import {
  Project,
  SyntaxKind,
  ts,
  SourceFile,
  Node,
  ClassDeclaration,
  ClassMemberTypes,
  BinaryExpression,
  Identifier,
  ConditionalExpression,
  ArrowFunction,
  ConstructorDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  MethodDeclaration,
  SetAccessorDeclaration,
  VariableDeclaration,
} from "ts-morph";
import { InterfaceInfo } from "./interface";

// Get all TypeScript files in a directory recursively
export function getTsFiles(dir: string): string[] {
  const stats = statSync(dir);

  if (!stats.isDirectory()) {
    // It's a file, return directly
    return dir.endsWith(".ts") ? [dir] : [];
  }

  return readdirSync(dir)
    .map((f) => join(dir, f))
    .flatMap((f) => {
      const s = statSync(f);
      if (s.isDirectory()) return getTsFiles(f);
      return f.endsWith(".ts") ? [f] : [];
    });
}

// A metric is `null` when the file has nothing to measure (e.g. no classes
// for accessModifiers). Null metrics are shown as n/a and excluded from the score.
export type MetricValue = number | null;

export interface ScoreMetrics {
  [key: string]: MetricValue;
}

export interface ScoreResult {
  file: string;
  score: number | null;
  metrics: ScoreMetrics;
  suggestions: string[];
}

function formatPercent(value: MetricValue): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

export function formatHumanReadable(scores: ScoreResult[]): string {
  return scores
    .map(
      (s) =>
        `\nFILE: ${s.file}\n\nSCORE: ${
          s.score === null ? "n/a" : `${s.score.toFixed(2)}/100`
        }\n\n${Object.entries(s.metrics)
          .map(([k, v]) => `${k}: ${formatPercent(v)}`)
          .join("\n")}\n\n${
          s.suggestions.length > 0
            ? `SUGGESTIONS:\n${s.suggestions.join("\n")}`
            : "No suggestions, great job!"
        }`,
    )
    .join("\n\n");
}

function isImperfect(value: MetricValue | undefined): boolean {
  return value !== null && value !== undefined && value < 1;
}

export function generateSuggestions(metrics: ScoreMetrics): string[] {
  const suggestions: string[] = [];
  if (isImperfect(metrics.avoidAny))
    suggestions.push("Replace `any` with specific types or `unknown`.");
  if (isImperfect(metrics.returnTypes))
    suggestions.push("Add explicit return types to functions.");
  if (isImperfect(metrics.accessModifiers))
    suggestions.push("Add access modifiers (public/private) to class members.");
  if (isImperfect(metrics.complexity))
    suggestions.push(
      "Simplify functions with high complexity by extracting logic.",
    );
  if (isImperfect(metrics.nesting))
    suggestions.push(
      "Reduce nesting with early returns or function extraction.",
    );
  if (isImperfect(metrics.preferConst))
    suggestions.push(
      "Use `const` instead of `let` for non-reassigned variables.",
    );
  if (isImperfect(metrics.avoidAssertions))
    suggestions.push("Replace type assertions with type guards.");
  if (isImperfect(metrics.useReadonly))
    suggestions.push("Mark immutable properties as `readonly`.");
  if (isImperfect(metrics.avoidVar))
    suggestions.push("Replace `var` with `let` or `const`.");
  if (isImperfect(metrics.optionalChaining))
    suggestions.push(
      "Use optional chaining (`?.`) and nullish coalescing (`??`) for null checks.",
    );
  return suggestions;
}

export const weights: Record<string, number> = {
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
const ATOMIC_TYPE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.AnyKeyword,
  SyntaxKind.UnknownKeyword,
  SyntaxKind.StringKeyword,
  SyntaxKind.NumberKeyword,
  SyntaxKind.BooleanKeyword,
  SyntaxKind.BigIntKeyword,
  SyntaxKind.SymbolKeyword,
  SyntaxKind.ObjectKeyword,
  SyntaxKind.VoidKeyword,
  SyntaxKind.NeverKeyword,
  SyntaxKind.UndefinedKeyword,
  SyntaxKind.TypeReference,
  SyntaxKind.LiteralType,
]);

export function calculateAvoidAny(sourceFile: SourceFile): MetricValue {
  let anyCount = 0;
  let atomicTypeCount = 0;
  for (const node of sourceFile.getDescendants()) {
    const kind = node.getKind();
    if (!ATOMIC_TYPE_KINDS.has(kind)) continue;
    // `void expr` also contains a VoidKeyword token; it is not a type
    if (
      kind === SyntaxKind.VoidKeyword &&
      node.getParent()?.getKind() === SyntaxKind.VoidExpression
    ) {
      continue;
    }
    atomicTypeCount++;
    if (kind === SyntaxKind.AnyKeyword) anyCount++;
  }
  if (atomicTypeCount === 0) return null;
  return 1 - anyCount / atomicTypeCount;
}

type FunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration
  | ArrowFunction
  | FunctionExpression;

function isFunctionLike(node: Node): node is FunctionLike {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  );
}

// `const f = () => {}`, `{ f: () => {} }`, `class A { f = () => {} }`, `x = () => {}`
function isAssignedFunction(fn: FunctionLike): boolean {
  let child: Node = fn;
  let parent = fn.getParent();
  while (parent && Node.isParenthesizedExpression(parent)) {
    child = parent;
    parent = parent.getParent();
  }
  if (!parent) return false;
  if (
    Node.isVariableDeclaration(parent) ||
    Node.isPropertyDeclaration(parent) ||
    Node.isPropertyAssignment(parent)
  ) {
    return parent.getInitializer() === child;
  }
  return (
    Node.isBinaryExpression(parent) &&
    parent.getOperatorToken().getText() === "=" &&
    parent.getRight() === child
  );
}

// A unit is a function that is scored on its own: declarations, methods,
// constructors, accessors and functions assigned to a name. Inline callbacks
// (`arr.map(x => ...)`) belong to the enclosing unit; a callback with no
// enclosing function is its own unit.
function isFunctionUnit(fn: FunctionLike): boolean {
  if (!fn.getBody()) return false; // overload signatures, abstract methods
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return true;
  if (isAssignedFunction(fn)) return true;
  return !fn.getFirstAncestor(isFunctionLike);
}

function getFunctionUnits(sourceFile: SourceFile): FunctionLike[] {
  return sourceFile
    .getDescendants()
    .filter(isFunctionLike)
    .filter(isFunctionUnit);
}

// Explicit return types are expected on declarations, methods and getters, and
// on functions assigned to an untyped name. Constructors, setters, inline
// callbacks and contextually typed functions are exempt.
function requiresReturnType(fn: FunctionLike): boolean {
  if (Node.isConstructorDeclaration(fn) || Node.isSetAccessorDeclaration(fn)) {
    return false;
  }
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return true;
  if (!isAssignedFunction(fn)) return false;
  const parent = fn.getParent();
  const owner = Node.isParenthesizedExpression(parent)
    ? parent.getParent()
    : parent;
  const isContextuallyTyped =
    (Node.isVariableDeclaration(owner) || Node.isPropertyDeclaration(owner)) &&
    owner.getTypeNode() !== undefined;
  return !isContextuallyTyped;
}

export function calculateReturnTypes(sourceFile: SourceFile): MetricValue {
  const functions = getFunctionUnits(sourceFile).filter(requiresReturnType);
  if (functions.length === 0) return null;
  const withReturn = functions.filter(
    (f) => Node.isReturnTyped(f) && f.getReturnTypeNode() !== undefined,
  ).length;
  return withReturn / functions.length;
}

export function calculateAccessModifiers(sourceFile: SourceFile): MetricValue {
  const classes = sourceFile.getClasses();
  if (classes.length === 0) return null;
  let members = 0;
  let withModifiers = 0;
  classes.forEach((cls: ClassDeclaration) => {
    cls.getMembers().forEach((member: ClassMemberTypes) => {
      members++;
      // Only count members that have getModifiers (not static blocks)
      if (
        typeof (member as any).getModifiers === "function" &&
        (member as any).getModifiers().length > 0
      ) {
        withModifiers++;
      }
    });
  });
  return members === 0 ? null : withModifiers / members;
}

// Descendants of a unit, excluding the bodies of nested units (those are
// scored on their own). Inline callbacks are included.
function getOwnDescendants(unit: FunctionLike): Node[] {
  const nodes: Node[] = [];
  unit.forEachDescendant((node, traversal) => {
    if (isFunctionLike(node) && isFunctionUnit(node)) {
      traversal.skip();
      return;
    }
    nodes.push(node);
  });
  return nodes;
}

const DECISION_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

function isLogicalAndOr(node: Node): boolean {
  if (!Node.isBinaryExpression(node)) return false;
  const operator = node.getOperatorToken().getKind();
  return (
    operator === SyntaxKind.AmpersandAmpersandToken ||
    operator === SyntaxKind.BarBarToken
  );
}

export function calculateComplexity(sourceFile: SourceFile): MetricValue {
  const units = getFunctionUnits(sourceFile);
  if (units.length === 0) return null;
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

const NESTING_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

// `else if` is flat control flow, not a deeper level of nesting
function isElseIf(node: Node, parent: Node): boolean {
  return (
    Node.isIfStatement(node) &&
    Node.isIfStatement(parent) &&
    parent.getElseStatement() === node
  );
}

function getNesting(node: Node, current = 0): number {
  let localMax = current;
  node.forEachChild((child: Node) => {
    // nested units are scored on their own
    if (isFunctionLike(child) && isFunctionUnit(child)) return;
    const increases =
      NESTING_KINDS.has(child.getKind()) && !isElseIf(child, node);
    const depth = increases ? current + 1 : current;
    localMax = Math.max(localMax, getNesting(child, depth));
  });
  return localMax;
}

export function calculateNesting(sourceFile: SourceFile): MetricValue {
  const units = getFunctionUnits(sourceFile);
  if (units.length === 0) return null;
  const maxNesting = Math.max(...units.map((unit) => getNesting(unit)));
  return Math.max(0, 1 - maxNesting / 4);
}

const ASSIGNMENT_OPERATORS: ReadonlySet<string> = new Set([
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

function isLoopInitializer(node: Node, parent: Node): boolean {
  return (
    (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) &&
    parent.getInitializer() === node
  );
}

// `[a, b] = [b, a]`, `({ a } = obj)`, `for ([a, b] of pairs)`
function isDestructuringAssignmentTarget(id: Identifier): boolean {
  let node: Node = id;
  let parent = node.getParent();
  while (parent) {
    if (
      Node.isArrayLiteralExpression(parent) ||
      Node.isObjectLiteralExpression(parent) ||
      Node.isSpreadElement(parent) ||
      Node.isSpreadAssignment(parent) ||
      Node.isShorthandPropertyAssignment(parent) ||
      Node.isParenthesizedExpression(parent) ||
      (Node.isPropertyAssignment(parent) && parent.getInitializer() === node)
    ) {
      node = parent;
      parent = node.getParent();
      continue;
    }
    if (node === id) return false;
    if (
      Node.isBinaryExpression(parent) &&
      parent.getOperatorToken().getText() === "=" &&
      parent.getLeft() === node
    ) {
      return true;
    }
    return isLoopInitializer(node, parent);
  }
  return false;
}

function isWriteReference(id: Identifier): boolean {
  const parent = id.getParent();
  if (!parent) return false;
  if (Node.isBinaryExpression(parent) && parent.getLeft() === id) {
    return ASSIGNMENT_OPERATORS.has(parent.getOperatorToken().getText());
  }
  if (
    (Node.isPrefixUnaryExpression(parent) ||
      Node.isPostfixUnaryExpression(parent)) &&
    parent.getOperand() === id
  ) {
    const operator = parent.getOperatorToken();
    return (
      operator === SyntaxKind.PlusPlusToken ||
      operator === SyntaxKind.MinusMinusToken
    );
  }
  if (isLoopInitializer(id, parent)) return true;
  return isDestructuringAssignmentTarget(id);
}

function bindingIdentifiers(declaration: VariableDeclaration): Identifier[] {
  const name = declaration.getNameNode();
  if (Node.isIdentifier(name)) return [name];
  return name
    .getDescendantsOfKind(SyntaxKind.BindingElement)
    .map((element) => element.getNameNode())
    .filter((n): n is Identifier => Node.isIdentifier(n));
}

// The region in which a `let` is visible and may be reassigned
function letScope(declaration: VariableDeclaration): Node {
  const statement = declaration.getParent()?.getParent();
  if (
    statement &&
    (Node.isForStatement(statement) ||
      Node.isForInStatement(statement) ||
      Node.isForOfStatement(statement))
  ) {
    return statement;
  }
  return (
    declaration.getFirstAncestor(
      (a) =>
        Node.isBlock(a) ||
        Node.isModuleBlock(a) ||
        Node.isCaseBlock(a) ||
        Node.isSourceFile(a),
    ) ?? declaration.getSourceFile()
  );
}

// A `let` is justified if it is reassigned anywhere in its scope (counters,
// accumulators, `i++` loops, destructuring assignment) or is declared without
// an initializer (deferred assignment). Name matching is syntactic, so a
// shadowing variable's writes can make this lenient, never stricter.
function needsLet(declaration: VariableDeclaration): boolean {
  const loopStatement = declaration.getParent()?.getParent();
  const isLoopVariable =
    !!loopStatement &&
    (Node.isForInStatement(loopStatement) ||
      Node.isForOfStatement(loopStatement));
  if (!declaration.getInitializer() && !isLoopVariable) return true;
  const names = new Set(bindingIdentifiers(declaration).map((i) => i.getText()));
  return letScope(declaration)
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((id) => names.has(id.getText()) && isWriteReference(id));
}

export function calculatePreferConst(sourceFile: SourceFile): MetricValue {
  const declarations = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((v: VariableDeclaration) => {
      const list = v.getParent();
      return list.getKind() === SyntaxKind.VariableDeclarationList;
    });
  const lets = declarations.filter(
    (v) => v.getParent().getFlags() & ts.NodeFlags.Let,
  );
  const consts = declarations.filter(
    (v) => v.getParent().getFlags() & ts.NodeFlags.Const,
  );
  const total = lets.length + consts.length;
  if (total === 0) return null;
  const unnecessaryLets = lets.filter((v) => !needsLet(v)).length;
  return 1 - unnecessaryLets / total;
}

export function calculateAvoidAssertions(sourceFile: SourceFile): MetricValue {
  const asNodes = sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression);
  // `as const` is a safe literal narrowing, not an unsafe type assertion
  const asAssertions = asNodes.filter(
    (n) => n.getTypeNode()?.getText() !== "const",
  ).length;
  const angleBracketAssertions = sourceFile.getDescendantsOfKind(
    SyntaxKind.TypeAssertionExpression,
  ).length;
  const nonNullAssertions = sourceFile.getDescendantsOfKind(
    SyntaxKind.NonNullExpression,
  ).length;
  const assertions = asAssertions + angleBracketAssertions + nonNullAssertions;
  // Every assertion kind is also part of the denominator, so the ratio can
  // never exceed 1. Calls and binary expressions are a proxy for "other code".
  const callExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  ).length;
  const binaryExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  ).length;
  const totalExpressions =
    asNodes.length +
    angleBracketAssertions +
    nonNullAssertions +
    callExpressions +
    binaryExpressions;
  if (totalExpressions === 0) return null;
  return Math.max(0, 1 - assertions / totalExpressions);
}

export function calculateUseReadonly(sourceFile: SourceFile): MetricValue {
  const properties = sourceFile.getDescendantsOfKind(
    SyntaxKind.PropertyDeclaration,
  );
  if (properties.length === 0) return null;
  // Only PropertyDeclaration nodes have getStructure().isReadonly
  const readonlyCount = properties.filter((p: Node) => {
    // Defensive: check getStructure exists and isReadonly is true
    return (
      typeof (p as any).getStructure === "function" &&
      (p as any).getStructure().isReadonly === true
    );
  }).length;
  return readonlyCount / properties.length;
}

export function calculateAvoidVar(sourceFile: SourceFile): MetricValue {
  const declarations = sourceFile.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  );
  if (declarations.length === 0) return null;
  return declarations
    .some(
      (v: VariableDeclaration) =>
        v.getParent().getKind() === SyntaxKind.VariableDeclarationList &&
        !(v.getParent().getFlags() & (ts.NodeFlags.Let | ts.NodeFlags.Const)),
    )
    ? 0
    : 1;
}

function stripWrappers(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function normalisedText(node: Node): string {
  return stripWrappers(node).getText().replace(/\s+/g, "");
}

// Receivers along an access chain: for `a.b.c()` this is ["a.b.c", "a.b", "a"].
// A null check on any of these could be replaced by `?.`.
function accessChainReceivers(node: Node): string[] {
  const receivers: string[] = [];
  let current = stripWrappers(node);
  while (
    Node.isPropertyAccessExpression(current) ||
    Node.isElementAccessExpression(current) ||
    Node.isCallExpression(current)
  ) {
    current = stripWrappers(current.getExpression());
    receivers.push(normalisedText(current));
  }
  return receivers;
}

function isNullish(node: Node): boolean {
  const n = stripWrappers(node);
  return (
    Node.isNullLiteral(n) || (Node.isIdentifier(n) && n.getText() === "undefined")
  );
}

interface NullGuard {
  target: string;
  // true: guard holds when `target` is present (x, x != null, !!x)
  // false: guard holds when `target` is absent (!x, x == null)
  presentWhenTrue: boolean;
}

// Recognise `x`, `!!x`, `!x`, `x != null`, `x !== undefined`, `x == null`, ...
function parseNullGuard(node: Node): NullGuard | undefined {
  const n = stripWrappers(node);
  if (Node.isPrefixUnaryExpression(n)) {
    if (n.getOperatorToken() !== SyntaxKind.ExclamationToken) return undefined;
    const operand = stripWrappers(n.getOperand());
    if (
      Node.isPrefixUnaryExpression(operand) &&
      operand.getOperatorToken() === SyntaxKind.ExclamationToken
    ) {
      return {
        target: normalisedText(operand.getOperand()),
        presentWhenTrue: true,
      };
    }
    return { target: normalisedText(operand), presentWhenTrue: false };
  }
  if (Node.isBinaryExpression(n)) {
    const operator = n.getOperatorToken().getText();
    const isNotEqual = operator === "!=" || operator === "!==";
    const isEqual = operator === "==" || operator === "===";
    if (!isNotEqual && !isEqual) return undefined;
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
  if (
    Node.isIdentifier(n) ||
    Node.isPropertyAccessExpression(n) ||
    Node.isElementAccessExpression(n)
  ) {
    return { target: normalisedText(n), presentWhenTrue: true };
  }
  return undefined;
}

function isAndExpression(node: Node): node is BinaryExpression {
  return (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
  );
}

// `x && x.y`, `x && x.y.z()`, `a && a.b && a.b.c`
function isManualAndGuard(expr: BinaryExpression): boolean {
  let guardNode: Node = stripWrappers(expr.getLeft());
  while (isAndExpression(guardNode)) {
    guardNode = stripWrappers(guardNode.getRight());
  }
  const guard = parseNullGuard(guardNode);
  if (!guard || !guard.presentWhenTrue) return false;
  return accessChainReceivers(expr.getRight()).includes(guard.target);
}

// `x ? x.y : d`, `x != null ? x.y : d`, `x == null ? d : x.y`
function isManualTernaryGuard(expr: ConditionalExpression): boolean {
  const guard = parseNullGuard(expr.getCondition());
  if (!guard) return false;
  const guarded = guard.presentWhenTrue ? expr.getWhenTrue() : expr.getWhenFalse();
  return accessChainReceivers(guarded).includes(guard.target);
}

export function calculateOptionalChaining(sourceFile: SourceFile): MetricValue {
  // Manual null-check patterns (`x && x.y`, `x ? x.y : d`) vs modern operators
  // (`?.`, `??`). Plain boolean logic such as `a > 1 && b < 2` is not counted.
  const manualNullChecks =
    sourceFile
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter(isManualAndGuard).length +
    sourceFile
      .getDescendantsOfKind(SyntaxKind.ConditionalExpression)
      .filter(isManualTernaryGuard).length;
  const modernOperators =
    sourceFile.getDescendantsOfKind(SyntaxKind.QuestionDotToken).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.QuestionQuestionToken).length;
  const totalNullChecks = manualNullChecks + modernOperators;
  if (totalNullChecks === 0) return null;
  return modernOperators / totalNullChecks;
}

export function calculateScore(metrics: ScoreMetrics): number | null {
  // Only metrics that have a defined weight and applied to this file count;
  // weights are re-normalised over the applicable metrics.
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, value] of Object.entries(metrics)) {
    const weight = weights[key];
    if (weight === undefined || value === null) continue;
    weightedSum += weight * value;
    totalWeight += weight;
  }
  return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : null;
}
