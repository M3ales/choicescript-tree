export interface TransitionMetadata {
  label?: string;
  targetScene?: string;
  targetSceneLabel?: string;
  dynamicExpression?: true;
  conditionStatementId?: string;
  optionStatementId?: string;
  choiceConditionId?: string;
  choiceConditionKind?: "if" | "elseif" | "else" | "selectable_if";
  effectiveReuse?: 'hide_reuse' | 'disable_reuse' | 'allow_reuse';
  implicitControlFlow?: true;
  gotoChain?: string[];
}
