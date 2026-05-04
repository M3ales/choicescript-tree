import { countIndentation } from "./indent";
import { IdentifierToken, NumberLiteralToken, ProseToken, Token } from "./tokens";

export const parseAchievementBlock = (
  headerLine: string,
  startPosition: number,
  preAchieveDescription: string,
  postAchieveDescription: string,
  lineNumber: number,
  indent: number,
  sceneName: string
): Token[] => {
  const tokens: Token[] = [];

  // [codename] [visibile/hidden] [points] [title]
  const [
    declaration,
    codename,
    visibility,
    points,
    ...titleParts
  ] = headerLine.split(" ");

  const title = titleParts.join(" ").trim();
  // console.log(declaration,codename,visibility,points,title)

  const headerLoc = (position: number) => ({
    lineNumber: lineNumber,
    position: position,
    indent: indent,
    sceneName: sceneName,
  });

  tokens.push(<IdentifierToken>{
    type: "Identifier",
    value: codename,
    rawValue: codename,
    ...headerLoc(headerLine.indexOf(codename, startPosition)),
  });

  tokens.push(<IdentifierToken>{
    type: "Identifier",
    value: visibility,
    rawValue: visibility,
    ...headerLoc(headerLine.indexOf(
      visibility,
      startPosition + codename.length + 1 // +1 for whitespace
    )),
  });

  tokens.push(<NumberLiteralToken>{
    type: "NumberLiteral",
    value: parseInt(points),
    ...headerLoc(headerLine.indexOf(
      points,
      startPosition + codename.length + visibility.length + 2 // +2 for whitespace
    )),
  });

  tokens.push(<ProseToken>{
    type: "Prose",
    content: title,
    ...headerLoc(headerLine.indexOf(
        title,
        startPosition + codename.length + visibility.length + points.length + 3 // +3 for whitespace
    )),
  });

  // Parse description lines
  const preAchieveIndent = countIndentation(preAchieveDescription).indent;
  if(preAchieveDescription.trim() === "hidden") {
    tokens.push(<IdentifierToken>{
        type: "Identifier",
        value: "hidden",
        rawValue: "hidden",
        lineNumber: lineNumber + 1,
        position: preAchieveDescription.indexOf("hidden"),
        indent: preAchieveIndent,
        sceneName: sceneName,
      });
  }
  else {
    tokens.push(<ProseToken>{
      type: "Prose",
      content: preAchieveDescription.trim(),
      lineNumber: lineNumber + 1,
      position: preAchieveDescription.indexOf(preAchieveDescription.trim()),
      indent: preAchieveIndent,
      sceneName: sceneName,
    });
  }

  const postAchieveIndent = countIndentation(postAchieveDescription).indent;

  tokens.push(<ProseToken>{
    type: "Prose",
    content: postAchieveDescription.trim(),
    lineNumber: lineNumber + 2,
    position: postAchieveDescription.indexOf(postAchieveDescription.trim()),
    indent: postAchieveIndent,
    sceneName: sceneName,
  })
  // Post-earned description


  return tokens;
};
