export type BlockEntryType =
  // First block of a scene file
  | "SceneEntry"

  // Block immediately proceeding a label definition
  | "Label"

  // First block inside a conditional body:
  //   *if condition
  //     <-- ConditionalBody: start of the *if body
  //     some code
  //   *else
  //     <-- ConditionalBody: start of the *else body
  //     other code
  | "ConditionalBody"

  // First block inside a choice option:
  //   # Sandwitch
  //     <-- ChoiceOptionEntry
  //     some code
  //   # Apple
  //     <-- ChoiceOptionEntry
  //     some code
  | "ChoiceOptionEntry"

  // Merge point where branches converge after a conditional:
  //   *if condition
  //     branch A
  //   *else
  //     branch B
  //   <-- Continuation: both branches resume here
  | "Continuation"

  // Resume point after a *gosub returns:
  //   *gosub subroutine
  //   <-- GoSubContinuation: execution resumes here after *return
  | "GoSubContinuation"

  | "InputContinuation"

  | "ImplicitControlFlowChange";
