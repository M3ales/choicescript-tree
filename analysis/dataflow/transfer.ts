import { Statement } from "../../parser/statements";
import { AbstractValue, top, input, range, constant } from "./abstract-value";
import { evaluateExpression } from "./evaluate-expression";
import { extractEffect } from "./extract-definitions";
import {
  VariableState,
  cloneState,
  getVariable,
  setVariable,
  updateVariable,
} from "./variable-state";

export const applyStatement = (
  state: VariableState,
  stmt: Statement,
  scene: string
): VariableState => {
  const effect = extractEffect(stmt);
  if (!effect.defines) return state;

  const def = effect.defines;
  const varName = def.variable;

  let value: AbstractValue;

  switch (stmt.kind) {
    case "DeclareVariable":
      value = def.valueExpression
        ? evaluateExpression(def.valueExpression, state, scene)
        : constant("");
      return setVariable(state, varName, value, def.scope, scene);

    case "SetVariable":
      if (def.isCompoundAssignment && def.compoundExpression) {
        value = evaluateExpression(def.compoundExpression, state, scene);
      } else if (def.valueExpression) {
        value = evaluateExpression(def.valueExpression, state, scene);
      } else {
        value = top;
      }
      return updateVariable(state, varName, value, scene);

    case "GenerateRandom": {
      const s = stmt as any;
      const minVal = evaluateExpression(s.min, state, scene);
      const maxVal = evaluateExpression(s.max, state, scene);
      if (minVal.kind === "constant" && maxVal.kind === "constant" &&
          typeof minVal.value === "number" && typeof maxVal.value === "number") {
        value = range(minVal.value, maxVal.value);
      } else {
        value = top;
      }
      return updateVariable(state, varName, value, scene);
    }

    case "InputText":
      return updateVariable(state, varName, input, scene);

    case "InputNumber": {
      const s = stmt as any;
      const minVal = evaluateExpression(s.min, state, scene);
      const maxVal = evaluateExpression(s.max, state, scene);
      if (minVal.kind === "constant" && maxVal.kind === "constant" &&
          typeof minVal.value === "number" && typeof maxVal.value === "number") {
        value = range(minVal.value, maxVal.value);
      } else {
        value = input;
      }
      return updateVariable(state, varName, value, scene);
    }

    default:
      return state;
  }
};

export const applyBlock = (
  state: VariableState,
  statements: Statement[],
  scene: string
): VariableState => {
  let current = state;
  for (const stmt of statements) {
    current = applyStatement(current, stmt, scene);
  }
  return current;
};
