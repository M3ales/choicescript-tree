import {
  Statement,
  DeclareVariableStatement,
  DeclareArrayStatement,
  ParametersStatement,
  GoSubStatement,
  GoSubSceneStatement,
  GotoLabelStatement,
  GotoSceneStatement,
} from "../../../parser/statements";
import { IdentifierToken } from "../../../scanner/tokens";
import { Cfg } from "../data";
import { CfgVisitor, BlockContext } from "../cfg-visitor";
import { collectRefsFromStatement } from "../collect-refs";
import { extractEffect } from "../../dataflow/extract-definitions";

export interface Declaration {
  name: string;
  scope: "Global" | "Temporary";
  isParam?: boolean;
}

export interface LabelRef {
  kind: "goto" | "gosub" | "goto_scene" | "gosub_scene";
  label?: string;
  scene?: string;
  stmtId: string;
  dynamic: boolean;
}

export interface CfgSymbols {
  cfgId: string;
  scene: string;
  declarations: Declaration[];
  sets: string[];
  refs: string[];
  labelRefs: LabelRef[];
}

export class SymbolTablePass implements CfgVisitor<CfgSymbols> {
  private declarations: Declaration[] = [];
  private sets: string[] = [];
  private refs: string[] = [];
  private labelRefs: LabelRef[] = [];

  onStatement(_ctx: BlockContext, stmtId: string, stmt: Statement): void {
    if (stmt.kind === "DeclareVariable") {
      const decl = stmt as DeclareVariableStatement;
      this.declarations.push({ name: decl.variable.value, scope: decl.scope });
    } else if (stmt.kind === "DeclareArray") {
      const arr = stmt as DeclareArrayStatement;
      this.declarations.push({ name: arr.variable.value, scope: arr.scope });
      for (const sub of arr.declarations) {
        this.declarations.push({ name: sub.variable.value, scope: sub.scope });
      }
    } else if (stmt.kind === "Parameters") {
      const params = stmt as ParametersStatement;
      for (const id of params.identifiers) {
        this.declarations.push({ name: id.value, scope: "Temporary", isParam: true });
      }
    }

    const effect = extractEffect(stmt);
    if (effect.defines && stmt.kind !== "DeclareVariable") {
      this.sets.push(effect.defines.variable);
    }

    const refs = collectRefsFromStatement(stmt);
    const defVar = effect.defines?.variable;
    for (const ref of refs) {
      if (ref !== defVar) this.refs.push(ref);
    }

    this.collectLabelRef(stmt, stmtId);
  }

  private collectLabelRef(stmt: Statement, stmtId: string): void {
    switch (stmt.kind) {
      case "GotoLabel": {
        const gt = stmt as GotoLabelStatement;
        const literal = isLiteralLabel(gt.label as any);
        this.labelRefs.push({
          kind: "goto",
          label: literal ? (gt.label as IdentifierToken).value : undefined,
          stmtId,
          dynamic: !literal,
        });
        break;
      }
      case "GotoScene": {
        const gs = stmt as GotoSceneStatement;
        const sceneLit = isLiteralLabel(gs.scene as any);
        const labelLit = gs.label ? isLiteralLabel(gs.label as any) : false;
        this.labelRefs.push({
          kind: "goto_scene",
          scene: sceneLit ? (gs.scene as IdentifierToken).value : undefined,
          label: labelLit ? (gs.label as IdentifierToken).value : undefined,
          stmtId,
          dynamic: !sceneLit,
        });
        break;
      }
      case "GoSub": {
        const gsub = stmt as GoSubStatement;
        const literal = isLiteralLabel(gsub.label as any);
        this.labelRefs.push({
          kind: "gosub",
          label: literal ? (gsub.label as IdentifierToken).value : undefined,
          stmtId,
          dynamic: !literal,
        });
        break;
      }
      case "GoSubScene": {
        const gss = stmt as GoSubSceneStatement;
        const sceneLit = isLiteralLabel(gss.scene as any);
        const labelLit = gss.label ? isLiteralLabel(gss.label as any) : false;
        this.labelRefs.push({
          kind: "gosub_scene",
          scene: sceneLit ? (gss.scene as IdentifierToken).value : undefined,
          label: labelLit ? (gss.label as IdentifierToken).value : undefined,
          stmtId,
          dynamic: !sceneLit,
        });
        break;
      }
    }
  }

  finish(cfg: Cfg): CfgSymbols {
    return {
      cfgId: cfg.id,
      scene: cfg.scene,
      declarations: this.declarations,
      sets: this.sets,
      refs: this.refs,
      labelRefs: this.labelRefs,
    };
  }
}

const isLiteralLabel = (ref: IdentifierToken | { kind?: string } | undefined): boolean =>
  ref != null && "type" in ref && ref["type"] !== undefined;

export interface VariableEntry {
  name: string;
  scope: "Global" | "Temporary";
  isParam?: boolean;
  declCount: number;
  setCount: number;
  refCount: number;
}

export interface MergedVariableTable {
  variables: Map<string, VariableEntry>;
  tempsByScene: Map<string, Map<string, VariableEntry>>;
}

export const mergeVariables = (cfgResults: CfgSymbols[]): MergedVariableTable => {
  const variables = new Map<string, VariableEntry>();
  const tempsByScene = new Map<string, Map<string, VariableEntry>>();

  const getOrCreate = (map: Map<string, VariableEntry>, name: string, scope: "Global" | "Temporary"): VariableEntry => {
    let entry = map.get(name);
    if (!entry) {
      entry = { name, scope, declCount: 0, setCount: 0, refCount: 0 };
      map.set(name, entry);
    }
    return entry;
  };

  const sceneMap = (scene: string): Map<string, VariableEntry> => {
    let map = tempsByScene.get(scene);
    if (!map) {
      map = new Map();
      tempsByScene.set(scene, map);
    }
    return map;
  };

  for (const result of cfgResults) {
    for (const decl of result.declarations) {
      if (decl.scope === "Temporary") {
        const entry = getOrCreate(sceneMap(result.scene), decl.name, decl.scope);
        entry.declCount++;
        if (decl.isParam) entry.isParam = true;
      } else {
        getOrCreate(variables, decl.name, decl.scope).declCount++;
      }
    }

    for (const name of result.sets) {
      const temps = tempsByScene.get(result.scene);
      if (temps?.has(name)) {
        temps.get(name)!.setCount++;
      } else {
        getOrCreate(variables, name, "Global").setCount++;
      }
    }

    for (const name of result.refs) {
      const temps = tempsByScene.get(result.scene);
      if (temps?.has(name)) {
        temps.get(name)!.refCount++;
      } else {
        getOrCreate(variables, name, "Global").refCount++;
      }
    }
  }

  return { variables, tempsByScene };
};
