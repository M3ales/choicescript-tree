import {
  ChoiceOptionStatement,
  ChoiceStatement,
  FakeChoiceStatement,
  GoSubSceneStatement,
  GoSubStatement,
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
      case "GoSub": {
        const gosub = statement as GoSubStatement;

        if (gosub.jankContinuedElseIfBranches.length > 0) {
          gosub.jankContinuedElseIfBranches.forEach((branch) => {
            visitStatement(branch);
            walk(branch.body, visitors);
          });
        }

        if (gosub.jankContinuedElseBranch) {
          visitStatement(gosub.jankContinuedElseBranch);
          walk(gosub.jankContinuedElseBranch.body, visitors);
        }
        break;
      }
      case "GoSubScene": {
        const gosubScene = statement as GoSubSceneStatement;

        if (gosubScene.jankContinuedElseIfBranches.length > 0) {
          gosubScene.jankContinuedElseIfBranches.forEach((branch) => {
            visitStatement(branch);
            walk(branch.body, visitors);
          });
        }

        if (gosubScene.jankContinuedElseBranch) {
          visitStatement(gosubScene.jankContinuedElseBranch);
          walk(gosubScene.jankContinuedElseBranch.body, visitors);
        }
        break;
      }
      default:
        break;
    }
  };

  statements.forEach(visitStatement);
};
