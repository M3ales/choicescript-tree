export type BlockExitType =
  | "FallThrough"
  | "Goto"
  | "GotoScene"
  | "GoSub"
  | "GoSubScene"
  | "Return"
  | "InlinedReturn" // Behaves the same as FallThrough
  | "Branch"
  | "Choice"
  | "Finish"
  | "Ending"
  | "Input"
  | "ImplicitEnd";

export const isReturnExit = (exitType: BlockExitType): boolean =>
  exitType === "Return" || exitType === "InlinedReturn";
