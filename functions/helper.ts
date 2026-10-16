import { join } from "path";
import { readdirSync, statSync } from "fs";
import {
  SyntaxKind,
  ts,
  SourceFile,
  Node,
  BinaryExpression,
  Identifier,
  ConditionalExpression,
  ArrowFunction,
  ConstructorDeclaration,
  KindToNodeMappings,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  MethodDeclaration,
  SetAccessorDeclaration,
  VariableDeclaration,
} from "ts-morph";

// ts-morph's getDescendants*/forEachDescendant recurse once per tree level and
// overflow the call stack on very deep trees (e.g. a chain of thousands of `+`).
// These helpers walk with an explicit stack in document order instead.
// `skip` stops the walk at a node: the node and its subtree are left out.
function descendants(root: Node, skip?: (node: Node) => boolean): Node[] {
  const result: Node[] = [];
  const stack: Node[] = [];
  const pushChildren = (node: Node): void => {
    const children: Node[] = [];
    node.forEachChild((child: Node) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  };
  pushChildren(root);
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (skip?.(node)) continue;
    result.push(node);
    pushChildren(node);
  }
  return result;
}

function descendantsOfKind<K extends SyntaxKind>(
  root: Node,
  kind: K,
): KindToNodeMappings[K][] {
  return descendants(root).filter(
    (node): node is KindToNodeMappings[K] => node.getKind() === kind,
  );
}

const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const DECLARATION_SUFFIXES = [".d.ts", ".d.mts", ".d.cts"];

function isTsFile(path: string): boolean {
  return TS_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isDeclarationFile(path: string): boolean {
  return DECLARATION_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

// Directories never worth scoring: dependencies, and hidden ones (.git, .next, ...)
function isSkippedDirectory(name: string, exclude: string[]): boolean {
  return name === "node_modules" || name.startsWith(".") || exclude.includes(name);
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error) return String(error.code);
  return "unknown error";
}

// Get all TypeScript files (.ts, .tsx, .mts, .cts) under a path, recursively.
// A file path given explicitly is always accepted. In directory scans,
// node_modules, hidden directories, declaration files (.d.ts) and anything
// named in `exclude` (file or directory basename) are skipped. Real directories
// are followed; symlinked directories are skipped (no loops) and broken
// symlinks or unreadable directories are skipped with a warning on stderr
// instead of aborting the whole run. Results are sorted for deterministic output.
export function getTsFiles(path: string, exclude: string[] = []): string[] {
  const stats = statSync(path);

  if (!stats.isDirectory()) {
    // It's a file, return directly
    return isTsFile(path) ? [path] : [];
  }

  const wanted = (name: string): boolean =>
    isTsFile(name) && !isDeclarationFile(name) && !exclude.includes(name);

  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    try {
      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name, exclude)) {
          files.push(...getTsFiles(full, exclude));
        }
      } else if (entry.isSymbolicLink()) {
        // Follow symlinks to files only, never to directories
        if (statSync(full).isFile() && wanted(entry.name)) files.push(full);
      } else if (entry.isFile() && wanted(entry.name)) {
        files.push(full);
      }
    } catch (error) {
      console.error(`warning: skipped ${full} (${errorCode(error)})`);
    }
  }
  return files.sort();
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
  // Syntax errors found by the TypeScript parser ("line N: message"). When
  // present, the metrics were computed on a partially parsed file.
  parseErrors: string[];
}

// Syntax errors reported by the TypeScript parser, as "line N: message".
// ts-morph parses broken files without complaint, so they would otherwise
// look like files with nothing to score. This only parses (no emit, no type
// checking, no module resolution), so it is cheap and cannot overflow on deep
// trees the way an emit would.
export function getSyntaxErrors(sourceFile: SourceFile): string[] {
  const fileName = sourceFile.getFilePath();
  const parsed = ts.createSourceFile(
    fileName,
    sourceFile.getFullText(),
    ts.ScriptTarget.Latest,
  );
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? parsed : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === fileName,
    readFile: () => undefined,
  };
  const program = ts.createProgram(
    [fileName],
    { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve },
    host,
  );
  return program
    .getSyntacticDiagnostics(parsed)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      if (!d.file || d.start === undefined) return message;
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `line ${line + 1}: ${message}`;
    });
}

const MAX_SHOWN_PARSE_ERRORS = 5;

function formatParseErrors(errors: string[]): string {
  if (errors.length === 0) return "";
  const shown = errors.slice(0, MAX_SHOWN_PARSE_ERRORS).map((e) => `  ${e}`);
  const hidden = errors.length - shown.length;
  if (hidden > 0) shown.push(`  ...and ${hidden} more`);
  return `WARNING: ${errors.length} syntax error(s), scores may be unreliable:\n${shown.join("\n")}\n\n`;
}

function formatPercent(value: MetricValue): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
}

export function formatHumanReadable(scores: ScoreResult[]): string {
  return scores
    .map(
      (s) =>
        `\nFILE: ${s.file}\n\n${formatParseErrors(s.parseErrors)}SCORE: ${
          s.score === null ? "n/a" : `${s.score.toFixed(2)}/100`
        }\n\n${Object.entries(s.metrics)
          .map(([k, v]) => `${k}: ${formatPercent(v)}`)
          .join("\n")}\n\n${
          s.suggestions.length > 0
            ? `SUGGESTIONS:\n${s.suggestions.join("\n")}`
            : s.parseErrors.length > 0
              ? ""
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
  for (const node of descendants(sourceFile)) {
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
  return descendants(sourceFile)
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

const ACCESS_MODIFIER_KINDS = new Set<SyntaxKind>([
  SyntaxKind.PublicKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.ProtectedKeyword,
]);

// Only an explicit public/private/protected counts (`static`, `async`,
// `readonly`, `override`... do not), and a `#private` name is private by
// definition. Constructors (conventionally written without `public`), static
// blocks and index signatures have no access level to declare, so they are
// not counted as members.
export function calculateAccessModifiers(sourceFile: SourceFile): MetricValue {
  const classes = sourceFile.getClasses();
  let members = 0;
  let withModifiers = 0;
  for (const cls of classes) {
    for (const member of cls.getMembers()) {
      if (
        Node.isConstructorDeclaration(member) ||
        Node.isClassStaticBlockDeclaration(member) ||
        Node.isIndexSignatureDeclaration(member)
      ) {
        continue;
      }
      members++;
      const hasKeyword =
        Node.isModifierable(member) &&
        member.getModifiers().some((m) => ACCESS_MODIFIER_KINDS.has(m.getKind()));
      const isHashPrivate =
        Node.isPropertyNamed(member) && Node.isPrivateIdentifier(member.getNameNode());
      if (hasKeyword || isHashPrivate) withModifiers++;
    }
  }
  return members === 0 ? null : withModifiers / members;
}

// Descendants of a unit, excluding the bodies of nested units (those are
// scored on their own). Inline callbacks are included.
function getOwnDescendants(unit: FunctionLike): Node[] {
  return descendants(unit, (node) => isFunctionLike(node) && isFunctionUnit(node));
}

const DECISION_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  // `try` is not a branch; only the `catch` adds a path
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

// Iterative (explicit stack) so very deep trees, such as a very long chain of
// binary expressions, cannot overflow the call stack.
function getNesting(root: Node): number {
  let maxDepth = 0;
  const stack: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const { node, depth } = item;
    maxDepth = Math.max(maxDepth, depth);
    node.forEachChild((child: Node) => {
      // nested units are scored on their own
      if (isFunctionLike(child) && isFunctionUnit(child)) return;
      const increases =
        NESTING_KINDS.has(child.getKind()) && !isElseIf(child, node);
      stack.push({ node: child, depth: increases ? depth + 1 : depth });
    });
  }
  return maxDepth;
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
function isDestructuringAssignmentTarget(target: Node): boolean {
  let node: Node = target;
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
    if (node === target) return false;
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

// Is this expression (identifier or property access) assigned to?
function isWriteTarget(target: Node): boolean {
  const parent = target.getParent();
  if (!parent) return false;
  if (Node.isBinaryExpression(parent) && parent.getLeft() === target) {
    return ASSIGNMENT_OPERATORS.has(parent.getOperatorToken().getText());
  }
  if (
    (Node.isPrefixUnaryExpression(parent) ||
      Node.isPostfixUnaryExpression(parent)) &&
    parent.getOperand() === target
  ) {
    const operator = parent.getOperatorToken();
    return (
      operator === SyntaxKind.PlusPlusToken ||
      operator === SyntaxKind.MinusMinusToken
    );
  }
  if (isLoopInitializer(target, parent)) return true;
  return isDestructuringAssignmentTarget(target);
}

function bindingIdentifiers(declaration: VariableDeclaration): Identifier[] {
  const name = declaration.getNameNode();
  if (Node.isIdentifier(name)) return [name];
  return descendantsOfKind(name, SyntaxKind.BindingElement)
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

// Every identifier that is written to (assignment, ++/--, destructuring
// assignment, loop variable), grouped by name. Computed once per file so each
// `let` is a map lookup instead of a scan of its whole scope.
function collectWriteReferences(
  sourceFile: SourceFile,
): Map<string, Identifier[]> {
  const writes = new Map<string, Identifier[]>();
  for (const id of descendantsOfKind(sourceFile, SyntaxKind.Identifier)) {
    if (!isWriteTarget(id)) continue;
    const name = id.getText();
    const existing = writes.get(name);
    if (existing) existing.push(id);
    else writes.set(name, [id]);
  }
  return writes;
}

// A `let` is justified if it is reassigned anywhere in its scope (counters,
// accumulators, `i++` loops, destructuring assignment) or is declared without
// an initializer (deferred assignment). Name matching is syntactic, so a
// shadowing variable's writes can make this lenient, never stricter.
function needsLet(
  declaration: VariableDeclaration,
  writes: Map<string, Identifier[]>,
): boolean {
  const loopStatement = declaration.getParent()?.getParent();
  const isLoopVariable =
    !!loopStatement &&
    (Node.isForInStatement(loopStatement) ||
      Node.isForOfStatement(loopStatement));
  if (!declaration.getInitializer() && !isLoopVariable) return true;
  const scope = letScope(declaration);
  const scopeStart = scope.getPos();
  const scopeEnd = scope.getEnd();
  return bindingIdentifiers(declaration).some((binding) =>
    (writes.get(binding.getText()) ?? []).some(
      (id) => id.getPos() >= scopeStart && id.getEnd() <= scopeEnd,
    ),
  );
}

export function calculatePreferConst(sourceFile: SourceFile): MetricValue {
  const declarations = descendantsOfKind(
    sourceFile,
    SyntaxKind.VariableDeclaration,
  ).filter(
    (v: VariableDeclaration) =>
      v.getParent().getKind() === SyntaxKind.VariableDeclarationList,
  );
  const lets = declarations.filter(
    (v) => v.getParent().getFlags() & ts.NodeFlags.Let,
  );
  const consts = declarations.filter(
    (v) => v.getParent().getFlags() & ts.NodeFlags.Const,
  );
  const total = lets.length + consts.length;
  if (total === 0) return null;
  const writes = lets.length > 0 ? collectWriteReferences(sourceFile) : new Map();
  const unnecessaryLets = lets.filter((v) => !needsLet(v, writes)).length;
  return 1 - unnecessaryLets / total;
}

export function calculateAvoidAssertions(sourceFile: SourceFile): MetricValue {
  const asNodes = descendantsOfKind(sourceFile, SyntaxKind.AsExpression);
  // `as const` is a safe literal narrowing, not an unsafe type assertion
  const asAssertions = asNodes.filter(
    (n) => n.getTypeNode()?.getText() !== "const",
  ).length;
  const angleBracketAssertions = descendantsOfKind(sourceFile, 
    SyntaxKind.TypeAssertionExpression,
  ).length;
  const nonNullAssertions = descendantsOfKind(sourceFile, 
    SyntaxKind.NonNullExpression,
  ).length;
  const assertions = asAssertions + angleBracketAssertions + nonNullAssertions;
  // Every assertion kind is also part of the denominator, so the ratio can
  // never exceed 1. Calls and binary expressions are a proxy for "other code".
  const callExpressions = descendantsOfKind(sourceFile, 
    SyntaxKind.CallExpression,
  ).length;
  const binaryExpressions = descendantsOfKind(sourceFile, 
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

// Names of properties assigned anywhere in the file (`x.name = ...`,
// `x.name += ...`, `x.name++`, `[x.name] = ...`). Writes to `this.name` directly
// inside a constructor are excluded: that is the one place `readonly` allows
// them. Matching is by name, so it can only be lenient, never stricter.
function collectMutatedProperties(sourceFile: SourceFile): Set<string> {
  const mutated = new Set<string>();
  const targets: Node[] = [
    ...descendantsOfKind(sourceFile, SyntaxKind.PropertyAccessExpression),
    ...descendantsOfKind(sourceFile, SyntaxKind.ElementAccessExpression),
  ];
  for (const target of targets) {
    let name: string | undefined;
    let receiver: Node | undefined;
    if (Node.isPropertyAccessExpression(target)) {
      name = target.getName();
      receiver = target.getExpression();
    } else if (Node.isElementAccessExpression(target)) {
      const argument = target.getArgumentExpression();
      if (argument && Node.isStringLiteral(argument)) {
        name = argument.getLiteralText();
        receiver = target.getExpression();
      }
    }
    if (name === undefined || !isWriteTarget(target)) continue;
    const inConstructor =
      receiver?.getKind() === SyntaxKind.ThisKeyword &&
      Node.isConstructorDeclaration(target.getFirstAncestor(isFunctionLike));
    if (!inConstructor) mutated.add(name);
  }
  return mutated;
}

// readonly properties / properties that could be readonly. A property that is
// reassigned outside the constructor can't be readonly, so it is not counted.
export function calculateUseReadonly(sourceFile: SourceFile): MetricValue {
  const mutated = collectMutatedProperties(sourceFile);
  let eligible = 0;
  let readonlyCount = 0;
  for (const property of descendantsOfKind(
    sourceFile,
    SyntaxKind.PropertyDeclaration,
  )) {
    if (property.isReadonly()) {
      eligible++;
      readonlyCount++;
    } else if (!mutated.has(property.getName())) {
      eligible++;
    }
  }
  return eligible === 0 ? null : readonlyCount / eligible;
}

// `using` / `await using` declarations are block scoped too, not `var`
const BLOCK_SCOPED_FLAGS =
  ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using;

export function calculateAvoidVar(sourceFile: SourceFile): MetricValue {
  const declarations = descendantsOfKind(sourceFile, 
    SyntaxKind.VariableDeclaration,
  );
  if (declarations.length === 0) return null;
  return declarations
    .some(
      (v: VariableDeclaration) =>
        v.getParent().getKind() === SyntaxKind.VariableDeclarationList &&
        !(v.getParent().getFlags() & BLOCK_SCOPED_FLAGS),
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
    descendantsOfKind(sourceFile, SyntaxKind.BinaryExpression)
      .filter(isManualAndGuard).length +
    descendantsOfKind(sourceFile, SyntaxKind.ConditionalExpression)
      .filter(isManualTernaryGuard).length;
  const modernOperators =
    descendantsOfKind(sourceFile, SyntaxKind.QuestionDotToken).length +
    descendantsOfKind(sourceFile, SyntaxKind.QuestionQuestionToken).length;
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
