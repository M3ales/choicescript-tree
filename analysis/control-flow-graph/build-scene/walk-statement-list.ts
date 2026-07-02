import {
  ChoiceOptionStatement,
  ChoiceStatement,
  DeclareArrayStatement,
  FakeChoiceStatement,
  GoSubSceneStatement,
  GoSubStatement,
  GotoLabelStatement,
  GotoSceneStatement,
  IfStatement,
  ParametersStatement,
  SetVariableStatement,
  Statement,
} from "../../../parser/statements";
import { IdentifierToken } from "../../../scanner/tokens";
import { BlockEntryType, Transition, CodeBlock, TransitionKind, TransitionMetadata } from "../data";
import { BuilderContext } from "./builder-context";
import { BlockSequence } from "./block-sequence";

const qualifyStmtId = (state: BuilderContext, stmtId: string): string =>
  `${state.sceneName}:${stmtId}`;

const beginCodeBlock = (state: BuilderContext, entryType: BlockEntryType): CodeBlock => {
  const id = `${state.sceneName}:b_${state.nextBlockNum++}`;
  const block: CodeBlock = {
    id,
    scene: state.sceneName,
    statementIds: [],
    entryType,
    exitType: "FallThrough",
  };
  state.blocks[id] = block;
  return block;
};

const connect = (
  state: BuilderContext,
  sourceBlockId: string,
  targetBlockId: string | null,
  kind: TransitionKind,
  metadata: TransitionMetadata = {}
): Transition => {
  const id = `${state.sceneName}:e_${state.nextEdgeNum++}`;
  const edge: Transition = { id, kind, sourceBlockId, targetBlockId, metadata };
  state.edges.push(edge);
  return edge;
};

const isLiteralLabelReference = (label: IdentifierToken | { kind?: string } | undefined): label is IdentifierToken => {
  return label != null && "type" in label && label["type"] !== undefined;
};

export const walkStatementList = (
  stmts: Statement[],
  state: BuilderContext,
  initialEntryType: BlockEntryType,
  isTopLevel: boolean
): BlockSequence => {
  let currentBlock = beginCodeBlock(state, initialEntryType);
  const entryBlockId = currentBlock.id;
  const exitBlockIds: string[] = [];

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];

    switch (stmt.kind) {
      case "Label": {
        const labelStmt = stmt as unknown as { label: IdentifierToken };
        const prevBlock = currentBlock;
        currentBlock = beginCodeBlock(state, "Label");
        connect(state, prevBlock.id, currentBlock.id, "FallThrough");
        currentBlock.label = labelStmt.label.value;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        state.labelToBlockId[labelStmt.label.value] = currentBlock.id;
        break;
      }

      case "GotoLabel": {
        const gotoStmt = stmt as GotoLabelStatement;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Goto";

        if (isLiteralLabelReference(gotoStmt.label as IdentifierToken)) {
          const label = (gotoStmt.label as IdentifierToken).value;
          const edge = connect(state, currentBlock.id, null, "Goto", { label });
          state.pendingTransitions.push({ edgeId: edge.id, label });
        } else {
          connect(state, currentBlock.id, null, "Unresolved", { dynamicExpression: true });
        }

        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }

      case "GotoScene": {
        const gotoScene = stmt as GotoSceneStatement;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "GotoScene";

        const metadata: TransitionMetadata = { targetScene: gotoScene.scene.value };
        if (gotoScene.label && isLiteralLabelReference(gotoScene.label as IdentifierToken)) {
          metadata.targetSceneLabel = (gotoScene.label as IdentifierToken).value;
        }
        connect(state, currentBlock.id, null, "GotoScene", metadata);

        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }

      case "Finish": {
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Finish";
        connect(state, currentBlock.id, null, "SceneExit");
        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }

      case "Ending":
      case "Bug": {
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Ending";
        connect(state, currentBlock.id, null, "GameEnd");
        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }

      case "Return": {
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Return";
        // Return blocks are left dead ends because they are linked when inlined
        connect(state, currentBlock.id, null, "Return");
        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }

      case "If": {
        const ifStmt = stmt as IfStatement;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Branch";

        const contBlock = beginCodeBlock(state, "Continuation");

        const ifResult = walkStatementList(ifStmt.body, state, "ConditionalBody", false);
        connect(state, currentBlock.id, ifResult.entryBlockId, "IfBranch", {
          conditionStatementId: qualifyStmtId(state, stmt.statementId),
        });
        
        for (const exitId of ifResult.exitBlockIds) {
          connect(state, exitId, contBlock.id, "FallThrough");
        }

        for (const branch of ifStmt.elseIfBranches) {
          const result = walkStatementList(branch.body, state, "ConditionalBody", false);
          const entryBlock = state.blocks[result.entryBlockId];
          if (entryBlock) entryBlock.statementIds.unshift(qualifyStmtId(state, branch.statementId));
          connect(state, currentBlock.id, result.entryBlockId, "ElseIfBranch", {
            conditionStatementId: qualifyStmtId(state, branch.statementId),
          });
          for (const exitId of result.exitBlockIds) {
            connect(state, exitId, contBlock.id, "FallThrough");
          }
        }

        if (ifStmt.elseBranch) {
          const result = walkStatementList(ifStmt.elseBranch.body, state, "ConditionalBody", false);
          const entryBlock = state.blocks[result.entryBlockId];
          if (entryBlock) entryBlock.statementIds.unshift(qualifyStmtId(state, ifStmt.elseBranch.statementId));
          connect(state, currentBlock.id, result.entryBlockId, "ElseBranch");
          for (const exitId of result.exitBlockIds) {
            connect(state, exitId, contBlock.id, "FallThrough");
          }
        } else {
          connect(state, currentBlock.id, contBlock.id, "IfFallThrough");
        }

        currentBlock = contBlock;
        break;
      }

      case "Choice":
      case "FakeChoice": {
        const choiceStmt = stmt as ChoiceStatement | FakeChoiceStatement;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Choice";

        const contBlock = beginCodeBlock(state, "Continuation");
        const isChoice = stmt.kind === "Choice";

        connectChoiceOptions(choiceStmt.body, currentBlock.id, contBlock.id, isChoice, state);

        if (isChoice) {
          connect(state, currentBlock.id, contBlock.id, "FallThrough");
        }

        currentBlock = contBlock;
        break;
      }

      case "GoSub":
      case "GoSubScene": {
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));

        if (stmt.kind === "GoSub") {
          const gosubStmt = stmt as GoSubStatement;
          currentBlock.exitType = "GoSub";

          if (isLiteralLabelReference(gosubStmt.label as IdentifierToken)) {
            const label = (gosubStmt.label as IdentifierToken).value;
            const edge = connect(state, currentBlock.id, null, "GoSubCall", { label });
            state.pendingTransitions.push({ edgeId: edge.id, label });
          } else {
            connect(state, currentBlock.id, null, "Unresolved", { dynamicExpression: true });
          }
        } else {
          const gosubScene = stmt as GoSubSceneStatement;
          currentBlock.exitType = "GoSubScene";

          const metadata: TransitionMetadata = { targetScene: gosubScene.scene.value };
          if (isLiteralLabelReference(gosubScene.label as IdentifierToken)) {
            metadata.label = (gosubScene.label as IdentifierToken).value;
          }
          connect(state, currentBlock.id, null, "GoSubSceneCall", metadata);
        }

        const contBlock = beginCodeBlock(state, "GoSubContinuation");
        connect(state, currentBlock.id, contBlock.id, "GoSubReturn");
        currentBlock = contBlock;

        break;
      }

      case "SetVariable": {
        const setStmt = stmt as SetVariableStatement;
        if ((setStmt.expression as any)?.token?.value === "implicit_control_flow") {
          if (currentBlock.statementIds.length > 0) {
            const prevBlock = currentBlock;
            currentBlock = beginCodeBlock(state, "ImplicitControlFlowChange");
            connect(state, prevBlock.id, currentBlock.id, "FallThrough");
          } else {
            currentBlock.entryType = "ImplicitControlFlowChange";
          }
        }
        if (stmt.statementId != null) {
          currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        }
        break;
      }

      case "InputText":
      case "InputNumber": {
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Input";
        const contBlock = beginCodeBlock(state, "InputContinuation");
        connect(state, currentBlock.id, contBlock.id, "InputReturn");
        currentBlock = contBlock;
        break;
      }

      case "Parameters": {
        const paramsStmt = stmt as ParametersStatement;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.parameterNames = paramsStmt.identifiers.map((id) => id.value);
        break;
      }

      case "HideReuse": {
        state.currentReuseMode = "hide_reuse";
        if (stmt.statementId != null) {
          currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        }
        break;
      }

      case "DisableReuse": {
        state.currentReuseMode = "disable_reuse";
        if (stmt.statementId != null) {
          currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        }
        break;
      }

      case "AllowReuse": {
        state.currentReuseMode = null;
        if (stmt.statementId != null) {
          currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        }
        break;
      }

      case "DeclareArray": {
        const arrayStmt = stmt as DeclareArrayStatement;
        if (stmt.statementId != null) {
          currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        }
        for (const decl of arrayStmt.declarations) {
          if (decl.statementId != null) {
            currentBlock.statementIds.push(qualifyStmtId(state, decl.statementId));
          }
        }
        break;
      }

      default:
        if (stmt.statementId != null) {
          currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        }
        break;
    }
  }

  if (currentBlock.exitType === "FallThrough") {
    const isReachable = currentBlock.id === entryBlockId ||
      state.edges.some(e => e.targetBlockId === currentBlock.id);
    if (isReachable) {
      if (isTopLevel) {
        currentBlock.exitType = "ImplicitEnd";
        connect(state, currentBlock.id, null, "SceneExit");
      }
      exitBlockIds.push(currentBlock.id);
    }
  }

  return { entryBlockId, exitBlockIds };
};

const connectChoiceOptions = (
  body: Statement[],
  choiceBlockId: string,
  contBlockId: string,
  isChoice: boolean,
  state: BuilderContext,
  choiceCondition?: { id: string; kind: "if" | "elseif" | "else" },
): void => {
  for (const child of body) {
    if (child.kind === "ChoiceOption") {
      const option = child as ChoiceOptionStatement;
      const result = walkStatementList(option.body, state, "ChoiceOptionEntry", false);
      const entryBlock = state.blocks[result.entryBlockId];
      if (entryBlock) entryBlock.statementIds.unshift(qualifyStmtId(state, option.statementId));
      const hasCheck = choiceCondition || option.selectableIf;
      const kind: TransitionKind = hasCheck ? "ChoiceOptionCheck" : "ChoiceOption";
      const metadata: TransitionMetadata = {
        optionStatementId: qualifyStmtId(state, option.statementId),
      };
      if (choiceCondition) {
        metadata.choiceConditionId = choiceCondition.id;
        metadata.choiceConditionKind = choiceCondition.kind;
      }
      if (option.selectableIf) {
        metadata.conditionStatementId = qualifyStmtId(state, option.statementId);
        if (!choiceCondition) {
          metadata.choiceConditionKind = "selectable_if";
        }
      }
      const effectiveReuse = option.reuse ?? state.currentReuseMode;
      if (effectiveReuse) {
        metadata.effectiveReuse = effectiveReuse;
      }
      connect(state, choiceBlockId, result.entryBlockId, kind, metadata);
      for (const exitId of result.exitBlockIds) {
        connect(state, exitId, contBlockId, "FallThrough",
          isChoice ? { implicitControlFlow: true } : {}
        );
      }
    } else if (child.kind === "If") {
      const ifStmt = child as IfStatement;
      const ifId = qualifyStmtId(state, ifStmt.statementId);
      const choiceBlock = state.blocks[choiceBlockId];
      if (choiceBlock) choiceBlock.statementIds.push(qualifyStmtId(state, ifStmt.statementId));
      connectChoiceOptions(ifStmt.body, choiceBlockId, contBlockId, isChoice, state,
        { id: ifId, kind: "if" });
      for (const branch of ifStmt.elseIfBranches) {
        if (choiceBlock) choiceBlock.statementIds.push(qualifyStmtId(state, branch.statementId));
        connectChoiceOptions(branch.body, choiceBlockId, contBlockId, isChoice, state,
          { id: qualifyStmtId(state, branch.statementId), kind: "elseif" });
      }
      if (ifStmt.elseBranch) {
        if (choiceBlock) choiceBlock.statementIds.push(qualifyStmtId(state, ifStmt.elseBranch.statementId));
        connectChoiceOptions(ifStmt.elseBranch.body, choiceBlockId, contBlockId, isChoice, state,
          { id: ifId, kind: "else" });
      }
    }
  }
};
