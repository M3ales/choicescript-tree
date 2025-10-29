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

  tokens.push(<IdentifierToken>{
    type: "Identifier",
    value: codename,
    lineNumber: lineNumber,
    position: headerLine.indexOf(codename, startPosition),
    indent: indent,
    sceneName: sceneName,
  });

  tokens.push(<IdentifierToken>{
    type: "Identifier",
    value: visibility,
    lineNumber: lineNumber,
    position: headerLine.indexOf(
      visibility,
      startPosition + codename.length + 1 // +1 for whitespace
    ),
    indent: indent,
    sceneName: sceneName,
  });

  tokens.push(<NumberLiteralToken>{
    type: "NumberLiteral",
    value: parseInt(points),
    lineNumber: lineNumber,
    position: headerLine.indexOf(
      points,
      startPosition + codename.length + visibility.length + 2 // +2 for whitespace
    ),
    indent: indent,
    sceneName: sceneName,
  });

  tokens.push(<ProseToken>{
    type: "Prose",
    content: title,
    lineNumber: lineNumber,
    position: headerLine.indexOf(
        title,
        startPosition + codename.length + visibility.length + points.length + 3 // +3 for whitespace
    ),
    indent: indent,
    sceneName: sceneName,
  });

  // Parse description lines
  const preAchieveIndent = countIndentation(preAchieveDescription);
  if(preAchieveDescription.trim() === "hidden") {
    tokens.push(<IdentifierToken>{
        type: "Identifier",
        value: "hidden",
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

  const postAchieveIndent = countIndentation(preAchieveDescription);

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

function countIndentation(line: string): number {
  let count = 0;

  for (const char of line) {
    const increment = scanIndent(char);
    if(increment === 0)
        break;
    count += increment;
  }

  return count;
}

export const scanIndent = (char: string) => {
    return char === "\t" ? 1 
         : char === " "  ? 0.5 
         : 0;
}