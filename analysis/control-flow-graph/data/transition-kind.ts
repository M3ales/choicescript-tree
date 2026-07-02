export type TransitionKind =
  | "FallThrough"
  | "Goto"
  | "GotoScene"
  | "GoSubCall"
  | "GoSubReturn"
  | "GoSubSceneCall"
  | "GoSubSceneReturn"
  | "Return"
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

export const isConditionalBranch = (kind: TransitionKind): boolean =>
  kind === "IfBranch" || kind === "ElseIfBranch" || kind === "ElseBranch" || kind === "IfFallThrough";
