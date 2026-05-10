export type TransitionKind =
  | "FallThrough"
  | "Goto"
  | "GotoScene"
  | "GoSubCall"
  | "GoSubReturn"
  | "GoSubSceneCall"
  | "GoSubSceneReturn"
  | "Return"
  | "InlinedGoSubCall"
  | "InlinedGoSubSceneCall"
  | "InlinedGoSubReturn"
  | "InlinedGoSubSceneReturn"
  | "InlinedReturn"
  | "IfBranch"
  | "ElseIfBranch"
  | "ElseBranch"
  | "IfFallThrough"
  | "ChoiceOption"
  | "ChoiceOptionCheck"
  | "SceneExit"
  | "GameEnd"
  | "InputReturn"
  | "SceneProgression"
  | "Unresolved";

export const isChoiceOptionEdge = (kind: TransitionKind): boolean =>
  kind === "ChoiceOption" || kind === "ChoiceOptionCheck";

export const isGoSubCall = (kind: TransitionKind): boolean =>
  kind === "GoSubCall" || kind === "GoSubSceneCall";

export const isGoSubReturn = (kind: TransitionKind): boolean =>
  kind === "GoSubReturn" || kind === "GoSubSceneReturn";

export const isInlinedGoSubCall = (kind: TransitionKind): boolean =>
  kind === "InlinedGoSubCall" || kind === "InlinedGoSubSceneCall";

export const isInlinedGoSubReturn = (kind: TransitionKind): boolean =>
  kind === "InlinedGoSubReturn" || kind === "InlinedGoSubSceneReturn";

export const isAnyGoSubCall = (kind: TransitionKind): boolean =>
  isGoSubCall(kind) || isInlinedGoSubCall(kind);

export const isAnyGoSubReturn = (kind: TransitionKind): boolean =>
  isGoSubReturn(kind) || isInlinedGoSubReturn(kind);

export const isConditionalBranch = (kind: TransitionKind): boolean =>
  kind === "IfBranch" || kind === "ElseIfBranch" || kind === "ElseBranch" || kind === "IfFallThrough";

export const goSubCallToInlined = (kind: TransitionKind): TransitionKind =>
  kind === "GoSubSceneCall" ? "InlinedGoSubSceneCall" : "InlinedGoSubCall";

export const goSubReturnToInlined = (kind: TransitionKind): TransitionKind =>
  kind === "GoSubSceneReturn" ? "InlinedGoSubSceneReturn" : "InlinedGoSubReturn";
