import { extname, resolve } from "path";
import { readdirSync, statSync } from "fs";
import {
  Project,
  SyntaxKind,
  ts,
  SourceFile,
  Node,
  ClassDeclaration,
  ClassMemberTypes,
  FunctionDeclaration,
  VariableDeclaration,
} from "ts-morph";
import { InterfaceInfo } from "./interface";

// Get all TypeScript files in a directory recursively
export function getTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const file of readdirSync(dir)) {
    const fullPath = resolve(dir, file);
    if (statSync(fullPath).isDirectory()) {
      files.push(...getTsFiles(fullPath));
    } else if (extname(fullPath) === ".ts" || extname(fullPath) === ".tsx") {
      files.push(fullPath);
    }
  }
  return files;
}

export interface ScoreMetrics {
  [key: string]: number;
}

export interface ScoreResult {
  file: string;
  score: number;
  metrics: ScoreMetrics;
  suggestions: string[];
}

export function formatHumanReadable(scores: ScoreResult[]): string {
  return scores
    .map(
      (s) =>
        `\nFILE: ${s.file}\n\nSCORE: ${s.score.toFixed(
          2,
        )}/100\n\n${Object.entries(s.metrics)
          .map(([k, v]) => `${k}: ${((v as number) * 100).toFixed(2)}%`)
          .join("\n")}\n\n${
          s.suggestions.length > 0
            ? `SUGGESTIONS:\n${s.suggestions.join("\n")}`
            : "No suggestions, great job!"
        }`,
    )
    .join("\n\n");
}

export function generateSuggestions(metrics: Record<string, number>): string[] {
  const suggestions: string[] = [];
  if (metrics.avoidAny < 1)
    suggestions.push("Replace `any` with specific types or `unknown`.");
  if (metrics.returnTypes < 1)
    suggestions.push("Add explicit return types to functions.");
  if (metrics.accessModifiers < 1)
    suggestions.push("Add access modifiers (public/private) to class members.");
  if (metrics.complexity < 1)
    suggestions.push(
      "Simplify functions with high complexity by extracting logic.",
    );
  if (metrics.nesting < 1)
    suggestions.push(
      "Reduce nesting with early returns or function extraction.",
    );
  if (metrics.preferConst < 1)
    suggestions.push(
      "Use `const` instead of `let` for non-reassigned variables.",
    );
  if (metrics.avoidAssertions < 1)
    suggestions.push("Replace type assertions with type guards.");
  if (metrics.useReadonly < 1)
    suggestions.push("Mark immutable properties as `readonly`.");
  if (metrics.avoidVar < 1)
    suggestions.push("Replace `var` with `let` or `const`.");
  if (metrics.optionalChaining < 1)
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

export function calculateAvoidAny(sourceFile: SourceFile): number {
  const anyCount = sourceFile.getDescendantsOfKind(
    SyntaxKind.AnyKeyword,
  ).length;
  const typeRefCount = sourceFile.getDescendantsOfKind(
    SyntaxKind.TypeReference,
  ).length;
  // Use total type nodes as denominator, fallback to total nodes if 0
  const denominator =
    typeRefCount > 0 ? typeRefCount : anyCount > 0 ? anyCount : 1;
  return 1 - anyCount / denominator;
}

export function calculateReturnTypes(sourceFile: SourceFile): number {
  const functions = sourceFile.getFunctions();
  if (functions.length === 0) return 1;
  const withReturn = functions.filter((f: FunctionDeclaration) =>
    f.getReturnTypeNode(),
  ).length;
  return withReturn / functions.length;
}

export function calculateAccessModifiers(sourceFile: SourceFile): number {
  const classes = sourceFile.getClasses();
  if (classes.length === 0) return 1;
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
  return members === 0 ? 1 : withModifiers / members;
}

export function calculateComplexity(sourceFile: SourceFile): number {
  const functions = sourceFile.getFunctions();
  if (functions.length === 0) return 1;
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

export function calculateNesting(sourceFile: SourceFile): number {
  const functions = sourceFile.getFunctions();
  if (functions.length === 0) return 1;
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

export function calculatePreferConst(sourceFile: SourceFile): number {
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
  return total === 0 ? 1 : consts.length / total;
}

export function calculateAvoidAssertions(sourceFile: SourceFile): number {
  const assertions =
    sourceFile.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.NonNullExpression).length;
  // Use a sum of common expression kinds as a proxy for total expressions
  const asExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.AsExpression,
  ).length;
  const callExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  ).length;
  const binaryExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  ).length;
  const totalExpressions =
    asExpressions + callExpressions + binaryExpressions || 1;
  return 1 - assertions / totalExpressions;
}

export function calculateUseReadonly(sourceFile: SourceFile): number {
  const properties = sourceFile.getDescendantsOfKind(
    SyntaxKind.PropertyDeclaration,
  );
  if (properties.length === 0) return 1;
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

export function calculateAvoidVar(sourceFile: SourceFile): number {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .some(
      (v: VariableDeclaration) =>
        v.getParent().getKind() === SyntaxKind.VariableDeclarationList &&
        !(v.getParent().getFlags() & (ts.NodeFlags.Let | ts.NodeFlags.Const)),
    )
    ? 0
    : 1;
}

export function calculateOptionalChaining(sourceFile: SourceFile): number {
  // Improved: Check for patterns like x && x.y (manual) vs x?.y (modern)
  let manualNullChecks = 0;
  let modernOperators = 0;
  sourceFile
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .forEach((e: Node) => {
      if (
        typeof (e as any).getOperatorToken === "function" &&
        (e as any).getOperatorToken().getKind() ===
          SyntaxKind.AmpersandAmpersandToken
      ) {
        manualNullChecks++;
      }
    });
  modernOperators += sourceFile.getDescendantsOfKind(
    SyntaxKind.QuestionDotToken,
  ).length;
  modernOperators += sourceFile.getDescendantsOfKind(
    SyntaxKind.QuestionQuestionToken,
  ).length;
  const totalNullChecks = manualNullChecks + modernOperators || 1;
  return modernOperators / totalNullChecks;
  // Removed stray closing brace at end of file
}

export function calculateScore(metrics: Record<string, number>): number {
  // Only use metrics that have a defined weight
  const weightedSum = Object.entries(metrics).reduce(
    (sum, [key, value]) =>
      weights[key] !== undefined ? sum + weights[key] * (value as number) : sum,
    0,
  );
  const totalWeight = Object.keys(weights).reduce(
    (sum, k) => sum + weights[k],
    0,
  );
  return totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 0;
}
