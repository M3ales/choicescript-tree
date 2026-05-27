import {
  ChoiceOptionStatement,
  ChoiceStatement,
  FakeChoiceStatement,
  IfStatement,
  Statement,
} from "../parser/statements";

export interface Visitor {
  predicate: (stmt: Statement) => boolean;
  visit: (stmt: Statement) => void;
}

export const walk = (
  statements: Statement[],
  visitors: Visitor[]
) => {
  const visitStatement = (statement: Statement) => {
    visitors.forEach(visitor => {
      if (visitor.predicate(statement)) {
        visitor.visit(statement);
      }
    });

    switch (statement.kind) {
      case "If": {
        const sub = statement as IfStatement;
        walk(sub.body, visitors);
        if (sub.elseIfBranches.length > 0) {
          sub.elseIfBranches.forEach((branch) => {
            walk(branch.body, visitors);
          });
        }
        if (sub.elseBranch) {
          walk(sub.elseBranch.body, visitors);
        }
        break;
      }
      case "Choice": {
        const choice = statement as ChoiceStatement;
        walk(choice.body, visitors);
        break;
      }
      case "FakeChoice": {
        const fakeChoice = statement as FakeChoiceStatement;
        walk(fakeChoice.body, visitors);
        break;
      }
      case "ChoiceOption": {
        const option = statement as ChoiceOptionStatement;
        walk(option.body, visitors);
        break;
      }
      case "GoSub":
      case "GoSubScene":
        break;
      default:
        break;
    }
  };

  statements.forEach(visitStatement);
};
