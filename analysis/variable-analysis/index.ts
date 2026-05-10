import "../../bootstrap";
import { readStatements, readInlineCfgRefs } from "../control-flow-graph/cfg-io";
import { readNdjsonSync, writeNdjson } from "../ndjson";
import { outPath, getIO } from "../../out-dir";
import { AbstractValue } from "../dataflow/abstract-value";
import { VariableSummary } from "../dataflow/dataflow-result";
import {
  Statement,
  SetVariableStatement,
  IfStatement,
  ElseIfStatement,
  ChoiceOptionStatement,
} from "../../parser/statements";
import {
  Expression,
  Binary,
  Unary,
  Identifier,
  Literal,
} from "../../parser/expressions";
import { Transition, isChoiceOptionEdge } from "../control-flow-graph/data";

// --- Load data ---

console.log("Loading statements...");
const statements = readStatements(outPath("game-statements.ndjson"));
console.log(`  ${Object.keys(statements).length} statements`);

console.log("Loading dataflow...");
const dataflowRecords = readNdjsonSync<Record<string, unknown>>(outPath("dataflow.ndjson"));
const variableSummaries = new Map<string, VariableSummary>();
for (const rec of dataflowRecords) {
  if (rec.type === "variable") {
    const vs = rec as unknown as VariableSummary & { type: string };
    const key = vs.scope === "Temporary" && vs.scene ? `${vs.scene}:${vs.name}` : vs.name;
    variableSummaries.set(key, vs);
  }
}
console.log(`  ${variableSummaries.size} variable summaries`);

console.log("Loading CFG edges...");
const cfg = readInlineCfgRefs(outPath("inline-cfg.ndjson"));
console.log(`  ${cfg.edges.length} edges`);

// --- Expression helpers ---

const extractVarNames = (expr: Expression): string[] => {
  const vars: string[] = [];
  const walk = (node: Expression): void => {
    if (!node) return;
    switch (node.kind) {
      case "Identifier":
        vars.push((node as Identifier).token.value);
        break;
      case "Binary": {
        const bin = node as Binary;
        walk(bin.left);
        walk(bin.right);
        break;
      }
      case "Unary":
        walk((node as Unary).value);
        break;
      case "Grouping":
      case "Dereference":
        walk(node.expression);
        break;
    }
  };
  walk(expr);
  return vars;
};

const formatExpr = (expr: Expression): string => {
  switch (expr.kind) {
    case "Literal": {
      const lit = expr as Literal;
      if (lit.value.type === "StringLiteral") return `"${lit.value.value}"`;
      return String(lit.value.value);
    }
    case "Identifier":
      return (expr as Identifier).token.value;
    case "Binary": {
      const bin = expr as Binary;
      const l = formatExpr(bin.left);
      const op = (bin.operator as { rawValue?: string }).rawValue ?? bin.operator.type;
      const r = formatExpr(bin.right);
      return `${l} ${op} ${r}`;
    }
    case "Unary": {
      const un = expr as Unary;
      return `${un.operator.rawValue}(${formatExpr(un.value)})`;
    }
    case "Grouping":
    case "Dereference":
      return formatExpr(expr.expression);
    default:
      return "?";
  }
};

const formatAbstractValue = (v: AbstractValue): string => {
  switch (v.kind) {
    case "constant":
      return typeof v.value === "string" ? `"${v.value}"` : String(v.value);
    case "set": {
      const vals = v.values.map((x) =>
        typeof x === "string" ? `"${x}"` : String(x)
      );
      const base = vals.join(", ");
      return v.hasUserInput ? `{${base}, user input}` : `{${base}}`;
    }
    case "range":
      return `${v.min}..${v.max}`;
    case "input":
      return "user input";
    case "loop":
      return "varies (loop)";
    case "top":
      return "any";
    case "bottom":
      return "unset";
  }
};

// --- Collect per-variable usage ---

interface SetOccurrence {
  stmtId: string;
  scene: string;
  line: number;
  formatted: string;
  isCompound: boolean;
}

interface ConditionOccurrence {
  stmtId: string;
  scene: string;
  line: number;
  conditionKind: "if" | "elseif" | "selectable_if";
  formatted: string;
}

interface GatedChoice {
  scene: string;
  line: number;
  optionText: string;
  condition: string;
  gateKind: "selectable_if" | "if";
}

interface VariableAnalysis {
  name: string;
  scope: "Global" | "Temporary";
  tempScene?: string;
  possibleValues: AbstractValue;
  sets: SetOccurrence[];
  conditions: ConditionOccurrence[];
  gatedChoices: GatedChoice[];
}

const analyses = new Map<string, VariableAnalysis>();

const getOrCreate = (name: string, scene?: string): VariableAnalysis => {
  const lower = name.toLowerCase();
  let entry = analyses.get(lower);
  if (!entry) {
    const sceneKey = scene ? `${scene}:${lower}` : undefined;
    const summary =
      (sceneKey ? variableSummaries.get(sceneKey) : undefined) ??
      variableSummaries.get(lower) ??
      variableSummaries.get(name);
    entry = {
      name: summary?.name ?? name,
      scope: summary?.scope ?? "Global",
      tempScene: summary?.scene,
      possibleValues: summary?.possibleValues ?? { kind: "bottom" },
      sets: [],
      conditions: [],
      gatedChoices: [],
    };
    analyses.set(lower, entry);
  }
  return entry;
};

const sceneOf = (stmtId: string): string => {
  const entry = cfg.statementIndex[stmtId];
  if (entry?.scene) return entry.scene;
  const stmt = statements[stmtId];
  const token = (stmt as any)?.token;
  return token?.sceneName ?? "?";
};

const lineOf = (stmt: Statement): number => {
  const token = (stmt as any).token;
  return token?.lineNumber ?? 0;
};

// Walk all statements
for (const [stmtId, stmt] of Object.entries(statements)) {
  const scene = sceneOf(stmtId);

  if (stmt.kind === "SetVariable") {
    const setStmt = stmt as SetVariableStatement;
    const expr = setStmt.expression;
    if (!expr) continue;

    let varName: string | null = null;
    let isCompound = false;

    if (expr.kind === "Identifier") {
      varName = (expr as Identifier).token.value;
    } else if (expr.kind === "Binary" && (expr as Binary).left.kind === "Identifier") {
      varName = ((expr as Binary).left as Identifier).token.value;
      isCompound = true;
    }

    if (varName && setStmt.assignment) {
      const analysis = getOrCreate(varName, scene);
      let formatted: string;
      if (isCompound) {
        const bin = expr as Binary;
        const op = (bin.operator as { rawValue?: string }).rawValue ?? bin.operator.type;
        formatted = `${varName} ${op} ${formatExpr(setStmt.assignment)}`;
      } else {
        formatted = `${varName} = ${formatExpr(setStmt.assignment)}`;
      }
      analysis.sets.push({
        stmtId,
        scene,
        line: lineOf(stmt),
        formatted,
        isCompound,
      });
    }
  }

  if (stmt.kind === "If" || stmt.kind === "ElseIf") {
    const condStmt = stmt as IfStatement | ElseIfStatement;
    const vars = extractVarNames(condStmt.expression);
    const formatted = formatExpr(condStmt.expression);
    for (const v of vars) {
      const analysis = getOrCreate(v, scene);
      analysis.conditions.push({
        stmtId,
        scene,
        line: lineOf(stmt),
        conditionKind: stmt.kind === "If" ? "if" : "elseif",
        formatted,
      });
    }
  }

  if (stmt.kind === "ChoiceOption") {
    const opt = stmt as ChoiceOptionStatement;
    if (opt.selectableIf) {
      const vars = extractVarNames(opt.selectableIf);
      const condFormatted = formatExpr(opt.selectableIf);
      const optionText = opt.token?.rawText ?? "?";
      for (const v of vars) {
        const analysis = getOrCreate(v, scene);
        analysis.gatedChoices.push({
          scene,
          line: lineOf(stmt),
          optionText: optionText.trim(),
          condition: condFormatted,
          gateKind: "selectable_if",
        });
      }
    }
  }
}

// Find *if-gated choice options via CFG edges
const edgesBySource = new Map<string, Transition[]>();
for (const edge of cfg.edges) {
  const list = edgesBySource.get(edge.sourceBlockId) ?? [];
  list.push(edge);
  edgesBySource.set(edge.sourceBlockId, list);
}

for (const edge of cfg.edges) {
  if (!isChoiceOptionEdge(edge.kind)) continue;
  const meta = edge.metadata;
  if (!meta.conditionStatementId || !meta.optionStatementId) continue;
  if (meta.choiceConditionKind === "selectable_if") continue;

  const condStmt = statements[meta.conditionStatementId];
  if (!condStmt) continue;
  if (condStmt.kind !== "If" && condStmt.kind !== "ElseIf") continue;

  const condExpr = (condStmt as IfStatement | ElseIfStatement).expression;
  const vars = extractVarNames(condExpr);

  const optStmt = statements[meta.optionStatementId];
  const optText = optStmt?.kind === "ChoiceOption"
    ? (optStmt as ChoiceOptionStatement).token?.rawText?.trim() ?? "?"
    : "?";

  const scene = sceneOf(meta.conditionStatementId);

  for (const v of vars) {
    const analysis = getOrCreate(v, scene);
    const already = analysis.gatedChoices.some(
      (g) => g.line === lineOf(condStmt) && g.scene === scene && g.optionText === optText
    );
    if (!already) {
      analysis.gatedChoices.push({
        scene,
        line: lineOf(condStmt),
        optionText: optText,
        condition: formatExpr(condExpr),
        gateKind: "if",
      });
    }
  }
}

// --- Output ---

const sorted = [...analyses.values()].sort((a, b) => {
  const score = (v: VariableAnalysis) =>
    v.gatedChoices.length * 3 + v.conditions.length * 2 + v.sets.length;
  return score(b) - score(a);
});

console.log(`Analysed ${sorted.length} variables`);

function* records() {
  for (const v of sorted) {
    yield {
      type: "variable",
      name: v.name,
      scope: v.scope,
      tempScene: v.tempScene,
      possibleValues: v.possibleValues,
      setCount: v.sets.length,
      compoundSetCount: v.sets.filter((s) => s.isCompound).length,
      conditionCount: v.conditions.length,
      gatedChoiceCount: v.gatedChoices.length,
      sets: v.sets,
      conditions: v.conditions,
      gatedChoices: v.gatedChoices,
    };
  }
}

const ndjsonCount = writeNdjson(outPath("variable-analysis.ndjson"), records());
console.log(`Wrote variable-analysis.ndjson (${ndjsonCount} records)`);

// Markdown report
const md: string[] = [];
md.push("# Variable Analysis\n");

for (const v of sorted) {
  if (v.sets.length === 0 && v.conditions.length === 0 && v.gatedChoices.length === 0) continue;

  md.push(`## ${v.name}`);
  md.push("");
  const scopeLabel =
    v.scope === "Temporary" ? `temp (${v.tempScene})` : "global";
  md.push(
    `- **Scope:** ${scopeLabel}`
  );
  md.push(`- **Possible values:** ${formatAbstractValue(v.possibleValues)}`);
  md.push(
    `- **Sets:** ${v.sets.length} (${v.sets.filter((s) => s.isCompound).length} compound)`
  );
  md.push(`- **Conditions:** ${v.conditions.length}`);
  md.push(`- **Gated choices:** ${v.gatedChoices.length}`);
  md.push("");

  if (v.sets.length > 0) {
    md.push("### Assignments");
    md.push("");
    for (const s of v.sets) {
      md.push(`- \`${s.formatted}\` — ${s.scene}:${s.line}`);
    }
    md.push("");
  }

  if (v.conditions.length > 0) {
    md.push("### Conditions");
    md.push("");
    for (const c of v.conditions) {
      md.push(`- \`*${c.conditionKind} (${c.formatted})\` — ${c.scene}:${c.line}`);
    }
    md.push("");
  }

  if (v.gatedChoices.length > 0) {
    md.push("### Gated Choices");
    md.push("");
    for (const g of v.gatedChoices) {
      const gate = g.gateKind === "selectable_if" ? "*selectable_if" : "*if";
      md.push(`- **${g.optionText}** — ${gate} (${g.condition}) — ${g.scene}:${g.line}`);
    }
    md.push("");
  }
}

getIO().writeFile(outPath("variable-analysis.md"), md.join("\n"));
console.log(`Wrote variable-analysis.md`);
