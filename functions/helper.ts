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
  ConditionalExpression,
  FunctionDeclaration,
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

export function calculateReturnTypes(sourceFile: SourceFile): MetricValue {
  const functions = sourceFile.getFunctions();
  if (functions.length === 0) return null;
  const withReturn = functions.filter((f: FunctionDeclaration) =>
    f.getReturnTypeNode(),
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

export function calculateComplexity(sourceFile: SourceFile): MetricValue {
  const functions = sourceFile.getFunctions();
  if (functions.length === 0) return null;
  let totalComplexity = 0;
  functions.forEach((f: FunctionDeclaration) => {
    let complexity = 1;
    complexity += f.getDescendantsOfKind(SyntaxKind.IfStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.SwitchStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.ForStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.ForInStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.ForOfStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.WhileStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.DoStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.TryStatement).length;
    complexity += f.getDescendantsOfKind(SyntaxKind.CatchClause).length;
    complexity += f.getDescendantsOfKind(
      SyntaxKind.ConditionalExpression,
    ).length;
    complexity += f
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter(
        (expr: Node) =>
          typeof (expr as any).getOperatorToken === "function" &&
          (expr as any).getOperatorToken().getKind() ===
            SyntaxKind.AmpersandAmpersandToken,
      ).length;
    complexity += f
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter(
        (expr: Node) =>
          typeof (expr as any).getOperatorToken === "function" &&
          (expr as any).getOperatorToken().getKind() === SyntaxKind.BarBarToken,
      ).length;
    totalComplexity += complexity;
  });
  const avgComplexity = totalComplexity / functions.length;
  return Math.max(0, 1 - (avgComplexity - 1) / 5); // Lowered threshold to 6 for more sensitivity
}

export function calculateNesting(sourceFile: SourceFile): MetricValue {
  const functions = sourceFile.getFunctions();
  if (functions.length === 0) return null;
  let maxNesting = 0;

  function getNesting(node: Node, current = 0): number {
    let localMax = current;
    node.forEachChild((child: Node) => {
      if (
        [
          SyntaxKind.IfStatement,
          SyntaxKind.SwitchStatement,
          SyntaxKind.ForStatement,
          SyntaxKind.ForInStatement,
          SyntaxKind.ForOfStatement,
          SyntaxKind.WhileStatement,
          SyntaxKind.DoStatement,
        ].includes(child.getKind())
      ) {
        localMax = Math.max(localMax, getNesting(child, current + 1));
      } else {
        localMax = Math.max(localMax, getNesting(child, current));
      }
    });
    return localMax;
  }

  functions.forEach((f: FunctionDeclaration) => {
    maxNesting = Math.max(maxNesting, getNesting(f));
  });

  return Math.max(0, 1 - maxNesting / 4);
}

export function calculatePreferConst(sourceFile: SourceFile): MetricValue {
  const lets = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(
      (v: VariableDeclaration) =>
        v.getParent().getKind() === SyntaxKind.VariableDeclarationList &&
        v.getParent().getFlags() & ts.NodeFlags.Let,
    );
  const consts = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(
      (v: VariableDeclaration) =>
        v.getParent().getKind() === SyntaxKind.VariableDeclarationList &&
        v.getParent().getFlags() & ts.NodeFlags.Const,
    );
  const total = lets.length + consts.length;
  return total === 0 ? null : consts.length / total;
}

export function calculateAvoidAssertions(sourceFile: SourceFile): MetricValue {
  const asNodes = sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression);
  // `as const` is a safe literal narrowing, not an unsafe type assertion
  const asAssertions = asNodes.filter(
    (n) => n.getTypeNode()?.getText() !== "const",
  ).length;
  const assertions =
    sourceFile.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.NonNullExpression).length +
    asAssertions;
  // Use a sum of common expression kinds as a proxy for total expressions
  const asExpressions = asNodes.length;
  const callExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  ).length;
  const binaryExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  ).length;
  const totalExpressions = asExpressions + callExpressions + binaryExpressions;
  if (totalExpressions === 0) return null;
  return 1 - assertions / totalExpressions;
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
