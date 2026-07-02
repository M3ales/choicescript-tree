"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode13 = __toESM(require("vscode"));

// src/pipeline.ts
var vscode = __toESM(require("vscode"));

// ../scanner/prefix-trie.ts
var PrefixTrie = class {
  root = { children: /* @__PURE__ */ new Map(), isTerminal: false };
  constructor(names) {
    for (const name of names) {
      let node = this.root;
      for (let i = 0; i < name.length; i++) {
        const ch = name[i];
        let child = node.children.get(ch);
        if (!child) {
          child = { children: /* @__PURE__ */ new Map(), isTerminal: false };
          node.children.set(ch, child);
        }
        node = child;
      }
      node.isTerminal = true;
    }
  }
  match(expression, cursor, isWordChar) {
    let node = this.root;
    let lastTerminalLen = -1;
    let i = cursor;
    while (i < expression.length) {
      const ch = expression[i].toLowerCase();
      const child = node.children.get(ch);
      if (!child) break;
      node = child;
      i++;
      if (node.isTerminal) {
        lastTerminalLen = i - cursor;
      }
    }
    if (lastTerminalLen > 0) {
      const endPos = cursor + lastTerminalLen;
      if (endPos < expression.length && isWordChar(expression[endPos])) {
        return { matched: null, rawValue: "", newCursor: cursor };
      }
      return {
        matched: expression.substring(cursor, endPos).toLowerCase(),
        rawValue: expression.substring(cursor, endPos),
        newCursor: endPos
      };
    }
    return { matched: null, rawValue: "", newCursor: cursor };
  }
};

// ../scanner/expression-handler.ts
function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}
function isLetter(char) {
  const code = char.charCodeAt(0);
  return code >= 97 && code <= 122 || code >= 65 && code <= 90;
}
var isLetterOrUnderscore = (char) => {
  return isLetter(char) || char === "_";
};
var isAlphanumericOrUnderscore = (char) => {
  return isLetter(char) || isDigit(char) || char === "_";
};
function tokenizeExpressionString(expression, lineNumber, position, indent, sceneName, knownLabels, sceneNames) {
  const labelTrie = knownLabels instanceof PrefixTrie ? knownLabels : new PrefixTrie(knownLabels);
  const sceneTrie = sceneNames instanceof PrefixTrie ? sceneNames : new PrefixTrie(sceneNames);
  const labelSet = knownLabels instanceof PrefixTrie ? null : new Set(knownLabels.map((l) => l.toLowerCase()));
  const leadingSpaces = expression.length - expression.trimStart().length;
  const trimmed = expression.trim();
  const lowerValue = trimmed.toLowerCase();
  const wholeLabel = labelTrie.match(lowerValue, 0, isAlphanumericOrUnderscore);
  if (wholeLabel.matched && wholeLabel.newCursor === lowerValue.length) {
    return [{
      type: "Identifier",
      value: lowerValue,
      rawValue: trimmed,
      position: position + leadingSpaces,
      lineNumber,
      sceneName,
      indent,
      isLabelName: true
    }];
  }
  const tokens = [];
  let cursor = 0;
  const baseAt = (offset) => ({
    position: position + offset,
    lineNumber,
    sceneName,
    indent
  });
  while (cursor < expression.length) {
    const char = expression[cursor];
    if (char === " " || char === "	") {
      cursor++;
      continue;
    }
    const sceneMatch = sceneTrie.match(expression, cursor, isAlphanumericOrUnderscore);
    if (sceneMatch.matched !== null) {
      const isAlsoLabelName = labelSet ? labelSet.has(sceneMatch.matched) : labelTrie.match(sceneMatch.matched, 0, isAlphanumericOrUnderscore).matched !== null;
      tokens.push({
        type: "Identifier",
        value: sceneMatch.matched,
        rawValue: sceneMatch.rawValue,
        ...baseAt(cursor),
        isSceneName: true,
        isLabelName: isAlsoLabelName
      });
      cursor = sceneMatch.newCursor;
      continue;
    }
    const labelMatch = labelTrie.match(expression, cursor, isAlphanumericOrUnderscore);
    if (labelMatch.matched !== null) {
      tokens.push({
        type: "Identifier",
        value: labelMatch.matched,
        rawValue: labelMatch.rawValue,
        ...baseAt(cursor),
        isLabelName: true
      });
      cursor = labelMatch.newCursor;
      continue;
    }
    if (isDigit(char)) {
      const startPos = cursor;
      let value = "";
      while (cursor < expression.length && (isDigit(expression[cursor]) || expression[cursor] === ".")) {
        value += expression[cursor];
        cursor++;
      }
      tokens.push({
        type: "NumberLiteral",
        value: parseFloat(value),
        ...baseAt(startPos)
      });
      continue;
    }
    if (char === '"') {
      const startPos = cursor;
      cursor++;
      const segments = [];
      let textBuf = "";
      let textPos = cursor;
      while (cursor < expression.length && expression[cursor] !== '"') {
        const c = expression[cursor];
        if (c === "$") {
          let openerLen = 0;
          if (expression[cursor + 1] === "{") openerLen = 2;
          else if (expression[cursor + 1] === "!" && expression[cursor + 2] === "{") openerLen = 3;
          else if (expression[cursor + 1] === "!" && expression[cursor + 2] === "!" && expression[cursor + 3] === "{") openerLen = 4;
          if (openerLen > 0) {
            if (textBuf) {
              segments.push({ kind: "text", value: textBuf, pos: textPos });
              textBuf = "";
            }
            const exprStart = cursor + openerLen;
            let depth = 1;
            let ei = exprStart;
            while (ei < expression.length && depth > 0) {
              if (expression[ei] === "{") depth++;
              else if (expression[ei] === "}") {
                depth--;
                if (depth === 0) break;
              } else if (expression[ei] === '"') {
                ei++;
                while (ei < expression.length && expression[ei] !== '"') {
                  if (expression[ei] === "\\" && ei + 1 < expression.length) ei++;
                  ei++;
                }
              }
              ei++;
            }
            const exprBody = expression.substring(exprStart, ei);
            segments.push({ kind: "expr", value: exprBody, pos: exprStart });
            cursor = ei < expression.length ? ei + 1 : ei;
            textPos = cursor;
            continue;
          }
        }
        if (c === "\\" && cursor + 1 < expression.length) {
          cursor++;
        }
        textBuf += expression[cursor];
        cursor++;
      }
      if (cursor < expression.length) {
        cursor++;
      }
      if (textBuf) {
        segments.push({ kind: "text", value: textBuf, pos: textPos });
      }
      const hasInterpolation = segments.some((s) => s.kind === "expr");
      if (!hasInterpolation) {
        const fullText = segments.length > 0 ? segments[0].value : "";
        tokens.push({
          type: "StringLiteral",
          value: fullText,
          ...baseAt(startPos)
        });
      } else {
        for (let si = 0; si < segments.length; si++) {
          const seg = segments[si];
          if (si > 0) {
            tokens.push({
              type: "ConcatenationOperator",
              rawValue: "&",
              synthetic: true,
              ...baseAt(seg.pos)
            });
          }
          if (seg.kind === "text") {
            tokens.push({
              type: "StringLiteral",
              value: seg.value,
              ...baseAt(seg.pos)
            });
          } else {
            tokens.push({ type: "OpenParenthesis", ...baseAt(seg.pos) });
            const innerTokens = tokenizeExpressionString(
              seg.value,
              lineNumber,
              position + seg.pos,
              indent,
              sceneName,
              knownLabels,
              sceneNames
            );
            tokens.push(...innerTokens);
            tokens.push({ type: "CloseParenthesis", ...baseAt(seg.pos + seg.value.length) });
          }
        }
      }
      continue;
    }
    switch (char) {
      case "(": {
        tokens.push({ type: "OpenParenthesis", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case ")": {
        tokens.push({ type: "CloseParenthesis", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case "[": {
        tokens.push({ type: "OpenSquareBracket", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case "]": {
        tokens.push({ type: "CloseSquareBracket", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case "{": {
        tokens.push({ type: "OpenBrace", ...baseAt(cursor) });
        cursor++;
        continue;
      }
    }
    if (cursor + 1 < expression.length) {
      const startPos = cursor;
      const twoChars = expression.substring(cursor, cursor + 2);
      switch (twoChars) {
        case "%+": {
          tokens.push({
            type: "FairmathAdditionOperator",
            rawValue: twoChars,
            ...baseAt(startPos)
          });
          cursor += 2;
          continue;
        }
        case "%-": {
          tokens.push({
            type: "FairmathSubtractionOperator",
            rawValue: twoChars,
            ...baseAt(startPos)
          });
          cursor += 2;
          continue;
        }
        case ">=": {
          tokens.push({
            type: "GreaterThanEqualsOperator",
            rawValue: twoChars,
            ...baseAt(startPos)
          });
          cursor += 2;
          continue;
        }
        case "<=": {
          tokens.push({
            type: "LessThanEqualsOperator",
            rawValue: twoChars,
            ...baseAt(startPos)
          });
          cursor += 2;
          continue;
        }
        case "!=": {
          tokens.push({
            type: "NotEqualityOperator",
            rawValue: twoChars,
            ...baseAt(startPos)
          });
          cursor += 2;
          continue;
        }
        case "@{": {
          tokens.push({ type: "OpenMultiReplace", ...baseAt(startPos) });
          cursor += 2;
          continue;
        }
        case "${": {
          tokens.push({ type: "OpenPrint", ...baseAt(startPos) });
          cursor += 2;
          continue;
        }
        case "$!{": {
          tokens.push({ type: "OpenPrintCapitaliseFirst", ...baseAt(startPos) });
          cursor += 2;
          continue;
        }
        case "$!!{": {
          tokens.push({ type: "OpenPrintCapitaliseAll", ...baseAt(startPos) });
          cursor += 2;
          continue;
        }
      }
    }
    switch (char) {
      case "+": {
        tokens.push({
          type: "AdditionOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "-": {
        tokens.push({
          type: "SubtractionOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "*": {
        tokens.push({
          type: "MultiplicationOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "/": {
        tokens.push({
          type: "DivisionOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "%": {
        tokens.push({
          type: "ModulusOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "&": {
        tokens.push({
          type: "ConcatenationOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "=": {
        tokens.push({
          type: "EqualityOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case ">": {
        tokens.push({
          type: "GreaterThanOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "<": {
        tokens.push({
          type: "LessThanOperator",
          rawValue: char,
          ...baseAt(cursor)
        });
        cursor++;
        continue;
      }
      case "|": {
        tokens.push({ type: "MultiReplaceElse", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case "}": {
        tokens.push({ type: "CloseBrace", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case "#": {
        tokens.push({ type: "Indexer", ...baseAt(cursor) });
        cursor++;
        continue;
      }
      case "$": {
        tokens.push({ type: "Dollar", ...baseAt(cursor) });
        cursor++;
        continue;
      }
    }
    if (isLetterOrUnderscore(char)) {
      const startPos = cursor;
      let value = "";
      while (cursor < expression.length && isAlphanumericOrUnderscore(expression[cursor])) {
        value += expression[cursor];
        cursor++;
      }
      switch (value) {
        case "true":
        case "false": {
          tokens.push({
            type: "BooleanLiteral",
            value: value === "true",
            ...baseAt(startPos)
          });
          continue;
        }
        case "and": {
          tokens.push({
            type: "LogicalAnd",
            rawValue: value,
            ...baseAt(startPos)
          });
          continue;
        }
        case "or": {
          tokens.push({
            type: "LogicalOr",
            rawValue: value,
            ...baseAt(startPos)
          });
          continue;
        }
        case "not": {
          tokens.push({
            type: "NotOperator",
            ...baseAt(startPos),
            rawValue: value
          });
          continue;
        }
        case "round": {
          tokens.push({
            type: "RoundOperator",
            ...baseAt(startPos),
            rawValue: value
          });
          continue;
        }
        case "length": {
          tokens.push({
            type: "LengthOperator",
            ...baseAt(startPos),
            rawValue: value
          });
          continue;
        }
        case "modulo": {
          tokens.push({
            type: "ModulusOperator",
            ...baseAt(startPos),
            rawValue: value
          });
          continue;
        }
        default: {
          tokens.push({
            type: "Identifier",
            value: value.toLowerCase(),
            rawValue: value,
            ...baseAt(startPos)
          });
          continue;
        }
      }
    }
    cursor++;
  }
  return tokens;
}

// ../scanner/indent.ts
var countIndentation = (line) => {
  if (!line) return { indent: 0, position: 0 };
  let indent = 0;
  let position = 0;
  for (const char of line) {
    const increment = scanIndentCharacter(char);
    if (increment === 0)
      break;
    indent += increment;
    position++;
  }
  return { indent, position };
};
var scanIndentCharacter = (char) => {
  return char === "	" ? 1 : char === " " ? 0.5 : 0;
};

// ../scanner/achievement-handler.ts
var parseAchievementBlock = (headerLine, startPosition, preAchieveDescription, postAchieveDescription, lineNumber, indent, sceneName) => {
  const tokens = [];
  const [
    declaration,
    codename,
    visibility,
    points,
    ...titleParts
  ] = headerLine.split(" ");
  const title = titleParts.join(" ").trim();
  const headerLoc = (position) => ({
    lineNumber,
    position,
    indent,
    sceneName
  });
  tokens.push({
    type: "Identifier",
    value: codename,
    rawValue: codename,
    ...headerLoc(headerLine.indexOf(codename, startPosition))
  });
  tokens.push({
    type: "Identifier",
    value: visibility,
    rawValue: visibility,
    ...headerLoc(headerLine.indexOf(
      visibility,
      startPosition + codename.length + 1
      // +1 for whitespace
    ))
  });
  tokens.push({
    type: "NumberLiteral",
    value: parseInt(points),
    ...headerLoc(headerLine.indexOf(
      points,
      startPosition + codename.length + visibility.length + 2
      // +2 for whitespace
    ))
  });
  tokens.push({
    type: "Prose",
    content: title,
    ...headerLoc(headerLine.indexOf(
      title,
      startPosition + codename.length + visibility.length + points.length + 3
      // +3 for whitespace
    ))
  });
  const preAchieveIndent = countIndentation(preAchieveDescription).indent;
  if (preAchieveDescription.trim() === "hidden") {
    tokens.push({
      type: "Identifier",
      value: "hidden",
      rawValue: "hidden",
      lineNumber: lineNumber + 1,
      position: preAchieveDescription.indexOf("hidden"),
      indent: preAchieveIndent,
      sceneName
    });
  } else {
    tokens.push({
      type: "Prose",
      content: preAchieveDescription.trim(),
      lineNumber: lineNumber + 1,
      position: preAchieveDescription.indexOf(preAchieveDescription.trim()),
      indent: preAchieveIndent,
      sceneName
    });
  }
  const postAchieveIndent = countIndentation(postAchieveDescription).indent;
  tokens.push({
    type: "Prose",
    content: postAchieveDescription.trim(),
    lineNumber: lineNumber + 2,
    position: postAchieveDescription.indexOf(postAchieveDescription.trim()),
    indent: postAchieveIndent,
    sceneName
  });
  return tokens;
};

// ../scanner/scene-list-handler.ts
var handleSceneList = (context) => {
  let startingIndent = context.indent.current;
  const tokens = [];
  while (true) {
    context.lineNumber++;
    const countIndent = countIndentation(context.sceneLines[context.lineNumber]);
    if (countIndent.indent <= startingIndent) {
      context.lineNumber--;
      context.position = context.sceneLines[context.lineNumber].length;
      break;
    }
    context.currentLine = context.sceneLines[context.lineNumber];
    context.indent.previous = context.indent.current;
    context.indent.current = countIndent.indent;
    context.position = countIndent.position;
    const trimmedLine = context.currentLine.trim();
    if (trimmedLine.length > 0) {
      const sceneName = trimmedLine;
      const token = {
        type: "Identifier",
        value: sceneName,
        rawValue: sceneName,
        sceneName: context.scene.name,
        lineNumber: context.lineNumber + 1,
        position: context.position,
        indent: context.indent.current,
        isLabelName: void 0,
        isSceneName: true
      };
      tokens.push(token);
    }
  }
  return tokens;
};

// ../scanner/stat-chart-handler.ts
var handleStatChart = (context) => {
  let startingIndent = context.indent.current;
  const tokens = [];
  const here = () => ({
    sceneName: context.scene.name,
    lineNumber: context.lineNumber,
    position: context.position,
    indent: context.indent.current
  });
  while (true) {
    const countIndent = countIndentation(context.sceneLines[context.lineNumber + 1]);
    if (countIndent.indent <= startingIndent) {
      context.position = context.sceneLines[context.lineNumber].length;
      break;
    }
    context.lineNumber++;
    context.currentLine = context.sceneLines[context.lineNumber];
    context.indent.previous = context.indent.current;
    context.indent.current = countIndent.indent;
    context.position = countIndent.position;
    const trimmedLine = context.currentLine.trim();
    if (trimmedLine.length > 0) {
      const { type, identifier, displayName } = lineToSegments(trimmedLine);
      tokens.push({
        type: "Identifier",
        value: type,
        rawValue: type,
        ...here()
      });
      context.position += type.length + 1;
      switch (type) {
        case "text": {
          tokens.push({
            type: "Identifier",
            value: identifier.toLowerCase(),
            rawValue: identifier,
            ...here()
          });
          context.position += identifier.length + 1;
          if (displayName !== void 0) {
            tokens.push({
              type: "Prose",
              content: displayName.join(" "),
              ...here()
            });
            context.position += displayName.join(" ").length + 1;
          }
          break;
        }
        case "opposed_pair": {
          tokens.push({
            type: "Identifier",
            value: identifier.toLowerCase(),
            rawValue: identifier,
            ...here()
          });
          context.position += identifier.length + 1;
          if (displayName !== void 0 && displayName.length > 0) {
            tokens.push({
              type: "Prose",
              content: displayName.join(" "),
              ...here()
            });
            context.position += displayName.join(" ").length + 1;
          }
          let linesToAdd = 0;
          const nextLine = context.sceneLines[context.lineNumber + 1];
          const nextLineIndent = countIndentation(nextLine);
          if (nextLineIndent.indent > context.indent.current) {
            tokens.push({
              type: "Prose",
              content: nextLine.trim(),
              sceneName: context.scene.name,
              lineNumber: context.lineNumber + 1,
              position: nextLineIndent.position + 1,
              indent: nextLineIndent.indent
            });
            linesToAdd++;
          }
          const following = context.sceneLines[context.lineNumber + 2];
          const followingLine = countIndentation(following);
          if (followingLine.indent > context.indent.current) {
            tokens.push({
              type: "Prose",
              content: following.trim(),
              sceneName: context.scene.name,
              lineNumber: context.lineNumber + 2,
              position: followingLine.position + 1,
              indent: followingLine.indent
            });
            linesToAdd++;
          }
          context.lineNumber += linesToAdd;
          context.position = 0;
          break;
        }
        case "percent": {
          tokens.push({
            type: "Identifier",
            value: identifier.toLowerCase(),
            rawValue: identifier,
            ...here()
          });
          if (displayName !== void 0) {
            tokens.push({
              type: "Prose",
              content: displayName.join(" "),
              ...here()
            });
          }
          break;
        }
      }
    }
  }
  return tokens;
};
var lineToSegments = (line) => {
  const segments = line.split(" ");
  const [type, identifier, ...displayName] = segments;
  return {
    type,
    identifier,
    displayName
  };
};

// ../scanner/image-handler.ts
var handleImage = (context) => {
  const tokens = [];
  const firstSpace = context.currentLine.indexOf(" ", context.position);
  const args = firstSpace === -1 ? "" : context.currentLine.substring(firstSpace + 1).trim();
  const { path, alignment, altText } = lineToSegments2(args);
  const at = (position) => ({
    sceneName: context.scene.name,
    position,
    lineNumber: context.lineNumber,
    indent: context.indent.current
  });
  if (path) {
    context.position = context.currentLine.indexOf(path);
    tokens.push({
      type: "Prose",
      ...at(context.position),
      content: path
    });
    context.position += path.length + 1;
  }
  if (alignment) {
    context.position = context.currentLine.indexOf(alignment, context.position);
    tokens.push({
      type: "Identifier",
      ...at(context.position),
      value: alignment,
      rawValue: alignment
    });
    context.position += alignment.length + 1;
  }
  if (altText && altText.length > 0) {
    context.position = context.currentLine.indexOf(altText[0], context.position);
    tokens.push({
      type: "Prose",
      ...at(context.position),
      content: context.currentLine.substring(context.position)
    });
  }
  context.position = context.currentLine.length;
  return tokens;
};
var lineToSegments2 = (line) => {
  const segments = line.split(" ");
  if (segments.length === 1) {
    return {
      path: line
    };
  }
  if (segments.length === 2) {
    const [path2, alignment2] = segments;
    return {
      path: path2,
      alignment: alignment2
    };
  }
  const [path, alignment, ...altText] = segments;
  if (alignment)
    return {
      path,
      alignment,
      altText
    };
};

// ../scanner/scanner.ts
var scanScene = (scene, knownLabels, knownSceneNames) => {
  const labelTrie = knownLabels instanceof PrefixTrie ? knownLabels : new PrefixTrie(knownLabels);
  const sceneTrie = knownSceneNames instanceof PrefixTrie ? knownSceneNames : new PrefixTrie(knownSceneNames);
  const context = {
    proseBlock: "",
    proseBlockStart: void 0,
    scene,
    lineNumber: 0,
    position: 0,
    mode: "Prose",
    currentToken: "",
    currentTokenStartPosition: void 0,
    insideMultiLineToken: false,
    indent: {
      current: 0,
      previous: void 0
    },
    currentLine: "",
    sceneLines: []
  };
  const tokens = [
    {
      sceneName: scene.name,
      lineNumber: 0,
      position: 0,
      indent: 0,
      type: "SceneStart"
    }
  ];
  context.sceneLines = scene.content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const checkpoints = [];
  let lastCheckpointLine = -1;
  let lastMode = "Initial";
  while (context.lineNumber < context.sceneLines.length) {
    if (context.lineNumber !== lastCheckpointLine) {
      lastCheckpointLine = context.lineNumber;
      checkpoints.push({
        line: context.lineNumber,
        previousIndent: context.indent.previous,
        proseBlockStartLine: context.proseBlockStart?.lineNumber,
        proseBlockIndent: context.proseBlockStart?.indent,
        tokenIndex: tokens.length
      });
    }
    if (lastMode !== context.mode) {
      lastMode = context.mode;
    }
    if (context.position >= context.sceneLines[context.lineNumber].length) {
      context.lineNumber++;
      context.position = 0;
      context.currentTokenStartPosition = void 0;
      context.mode = "Prose";
      context.currentTokenStartPosition = 0;
      context.currentToken = "";
      context.indent.previous = context.indent.current;
      context.indent.current = 0;
      if (context.proseBlock.trim().length !== 0) {
        context.proseBlock += "\n";
      }
      continue;
    }
    const line = context.sceneLines[context.lineNumber];
    context.currentLine = line;
    if (line.trim().length === 0) {
      context.position = line.length;
      context.indent.current = context.indent.previous;
      continue;
    }
    const lineIndent = countIndentation(line);
    const afterIndentation = context.position === lineIndent.position;
    context.indent.current = lineIndent.indent;
    context.position = lineIndent.position;
    if (context.insideMultiLineToken && context.indent.previous > context.indent.current) {
      context.insideMultiLineToken = false;
    }
    while (context.position < line.length) {
      switch (context.mode) {
        case "Prose": {
          if (context.proseBlockStart !== void 0) {
            const indentChangedInProseBlock = lineIndent.indent !== context.proseBlockStart.indent;
            if (indentChangedInProseBlock) {
              flushProseBlock(tokens, context);
              continue;
            }
          }
          if (afterIndentation && !(line.includes("*") || line.includes("#"))) {
            if (context.proseBlockStart === void 0) {
              context.proseBlockStart = {
                position: context.position,
                lineNumber: context.lineNumber,
                indent: context.indent.current
              };
            }
            context.proseBlock += line.trimStart();
            context.position = line.length;
            continue;
          }
          if (isStartOfCommand(context)) {
            context.mode = "Command";
            context.currentTokenStartPosition = context.position;
            flushProseBlock(tokens, context);
            continue;
          }
          if (context.position > 0 && line[context.position] === "#" && (line.substring(0, context.position).trim().length === 0 || isAfterChoiceModifierOnSameLine(tokens, context.lineNumber))) {
            context.currentTokenStartPosition = context.position;
            context.currentToken = "";
            context.mode = "ChoiceOption";
            flushProseBlock(tokens, context);
            continue;
          }
          if (context.proseBlockStart === void 0) {
            context.proseBlockStart = {
              position: context.position,
              lineNumber: context.lineNumber,
              indent: context.indent.current
            };
          }
          context.proseBlock += line[context.position];
          context.position++;
          break;
        }
        case "ProseToEOL": {
          if (context.position < line.length) {
            if (context.proseBlock.length > 0) {
              console.error("Unexpected ProseToEOL mode with existing prose block");
            }
            context.proseBlock = "";
            const substring = line.substring(context.position);
            tokens.push({
              indent: context.indent.current,
              type: "Prose",
              sceneName: scene.name,
              content: substring.trimStart(),
              lineNumber: context.lineNumber,
              position: context.position
            });
            context.position = line.length;
          }
          context.mode = "Prose";
          break;
        }
        case "SceneArgToEOL": {
          const sch = line[context.position];
          if (sch === " " || sch === "	") {
            context.position++;
            break;
          }
          if (sch === "{") {
            context.mode = "Expression";
            context.currentTokenStartPosition = context.position;
            context.currentToken = sch;
            context.position++;
            break;
          }
          const sstart = context.position;
          let send = sstart;
          while (send < line.length && line[send] !== " " && line[send] !== "	") send++;
          const sraw = line.substring(sstart, send);
          tokens.push({
            type: "Identifier",
            value: sraw.toLowerCase(),
            rawValue: sraw,
            sceneName: scene.name,
            indent: context.indent.current,
            lineNumber: context.lineNumber,
            position: sstart,
            isSceneName: true
          });
          context.position = send;
          context.mode = send < line.length ? "LabelToEOL" : "Prose";
          break;
        }
        case "LabelToEOL": {
          const ch = line[context.position];
          if (ch === " " || ch === "	") {
            context.position++;
            break;
          }
          if (ch === "{") {
            context.mode = "Expression";
            context.currentTokenStartPosition = context.position;
            context.currentToken = ch;
            context.position++;
            break;
          }
          const start = context.position;
          let end = start;
          while (end < line.length && line[end] !== " " && line[end] !== "	") end++;
          const raw = line.substring(start, end);
          tokens.push({
            type: "Identifier",
            value: raw.toLowerCase(),
            rawValue: raw,
            sceneName: scene.name,
            indent: context.indent.current,
            lineNumber: context.lineNumber,
            position: start,
            isLabelName: true
          });
          context.position = end;
          if (context.gosubArgs && end < line.length) {
            context.mode = "GoSubArgsToEOL";
            context.gosubArgs = false;
          } else {
            context.gosubArgs = false;
            context.mode = end < line.length ? "LabelToEOL" : "Prose";
          }
          break;
        }
        case "GoSubArgsToEOL": {
          const gaCh = line[context.position];
          if (gaCh === " " || gaCh === "	") {
            context.position++;
            break;
          }
          const gaStart = context.position;
          let gaEnd = gaStart;
          let gaDepth = 0;
          while (gaEnd < line.length) {
            const c = line[gaEnd];
            if (c === "(") gaDepth++;
            else if (c === ")") gaDepth--;
            else if ((c === " " || c === "	") && gaDepth <= 0) break;
            gaEnd++;
          }
          const gaRaw = line.substring(gaStart, gaEnd);
          const gaTokens = tokenizeExpressionString(
            gaRaw,
            context.lineNumber,
            gaStart,
            context.indent.current,
            context.scene.name,
            labelTrie,
            sceneTrie
          );
          tokens.push(...gaTokens);
          context.position = gaEnd;
          if (gaEnd >= line.length) {
            context.mode = "Prose";
          }
          break;
        }
        case "Expression": {
          if (isStartOfCommand(context)) {
            var expressionTokens = tokenizeExpressionString(
              context.currentToken,
              context.lineNumber,
              context.currentTokenStartPosition,
              context.indent.current,
              context.scene.name,
              labelTrie,
              sceneTrie
            );
            tokens.push(...expressionTokens);
            context.mode = "Command";
            context.currentTokenStartPosition = context.position;
            context.currentToken = "";
            continue;
          }
          if (isStartOfChoiceOption(line[context.position], line[context.position - 1])) {
            var expressionTokens = tokenizeExpressionString(
              context.currentToken,
              context.lineNumber,
              context.currentTokenStartPosition,
              context.indent.current,
              context.scene.name,
              labelTrie,
              sceneTrie
            );
            tokens.push(...expressionTokens);
            context.currentTokenStartPosition = context.position;
            context.mode = "ChoiceOption";
            continue;
          }
          if (context.currentTokenStartPosition == void 0)
            context.currentTokenStartPosition = context.position;
          context.currentToken += line[context.position];
          if (context.position == line.length - 1) {
            var expressionTokens = tokenizeExpressionString(
              context.currentToken,
              context.lineNumber,
              context.currentTokenStartPosition,
              context.indent.current,
              context.scene.name,
              labelTrie,
              sceneTrie
            );
            tokens.push(...expressionTokens);
          }
          context.position++;
          break;
        }
        case "Command": {
          context.currentToken += line[context.position];
          const token = handleCommand(context);
          if (token != void 0) {
            tokens.push(token);
          }
          context.position++;
          break;
        }
        case "Comment": {
          context.position++;
          const comment = tokens[tokens.length - 1];
          if (comment.type !== "Comment") {
            console.error("Unexpected comment mode entry, head is not a comment block");
          }
          comment.value = line.substring(context.position).trimEnd();
          context.currentToken = "";
          context.currentTokenStartPosition = void 0;
          context.position = line.length;
          break;
        }
        case "ChoiceOption": {
          const choiceOption = handleChoiceOption(context);
          tokens.push(choiceOption);
          context.position++;
          choiceOption.rawText = line.substring(context.position);
          const multiReplaceBegin = choiceOption.rawText.indexOf("@{");
          choiceOption.hasMultiReplace = multiReplaceBegin !== -1;
          context.currentToken = "";
          context.currentTokenStartPosition = void 0;
          context.position = line.length;
          break;
        }
        case "Achievement": {
          const preLine = context.sceneLines[context.lineNumber + 1];
          const postLine = context.sceneLines[context.lineNumber + 2];
          const scanned = parseAchievementBlock(
            line,
            context.position,
            preLine,
            postLine,
            context.lineNumber,
            context.indent.current,
            context.scene.name
          );
          tokens.push(...scanned);
          context.position = line.length;
          context.lineNumber += 2;
          context.insideMultiLineToken = false;
          context.proseBlock = "";
          context.proseBlockStart = void 0;
          context.mode = "Prose";
          break;
        }
        case "StatChart": {
          const lineRemaining = context.currentLine.substring(context.position).trim();
          if (lineRemaining.length === 0) {
            context.position = context.currentLine.length;
          }
          tokens.push({
            indent: context.indent.current,
            type: "Prose",
            sceneName: scene.name,
            content: lineRemaining,
            lineNumber: context.lineNumber,
            position: context.position
          });
          context.position = line.length;
          break;
        }
        case "SceneList": {
          context.position = line.length;
          break;
        }
        case "Image": {
          const imageTokens = handleImage(context);
          tokens.push(...imageTokens);
          context.mode = "Prose";
          break;
        }
      }
    }
    switch (context.mode) {
      case "SceneList": {
        tokens.push(...handleSceneList(context));
        break;
      }
      case "StatChart": {
        tokens.push(...handleStatChart(context));
        break;
      }
    }
  }
  tokens.push(
    {
      lineNumber: context.sceneLines.length,
      indent: 0,
      position: 0,
      sceneName: scene.name,
      type: "SceneEnd"
    }
  );
  return { tokens, checkpoints };
};
var choiceModifierTokenTypes = /* @__PURE__ */ new Set(["HideReuse", "DisableReuse", "AllowReuse"]);
var isAfterChoiceModifierOnSameLine = (tokens, lineNumber) => {
  const last = tokens[tokens.length - 1];
  return last !== void 0 && last.lineNumber === lineNumber && choiceModifierTokenTypes.has(last.type);
};
var flushProseBlock = (tokens, context) => {
  if (context.proseBlockStart !== void 0 && context.proseBlock.trim().length > 0) {
    tokens.push({
      indent: context.proseBlockStart.indent,
      type: "Prose",
      sceneName: context.scene.name,
      content: context.proseBlock.trimStart(),
      lineNumber: context.proseBlockStart.lineNumber,
      position: context.proseBlockStart.position
    });
  }
  context.proseBlock = "";
  context.proseBlockStart = void 0;
};
var handleChoiceOption = (context) => {
  context.mode = "ChoiceOption";
  return {
    type: "ChoiceOption",
    sceneName: context.scene.name,
    indent: context.indent.current,
    lineNumber: context.lineNumber,
    position: context.currentTokenStartPosition
  };
};
var handleCommand = (context) => {
  const createInContextToken = (token) => {
    token.sceneName = context.scene.name;
    token.indent = context.indent.current;
    token.lineNumber = context.lineNumber;
    token.position = context.currentTokenStartPosition;
    context.currentTokenStartPosition = void 0;
    context.currentToken = "";
    return token;
  };
  switch (context.currentToken) {
    case "*label": {
      const nextChar = context.currentLine[context.position + 1];
      if (nextChar !== void 0 && nextChar !== " " && nextChar !== "	") break;
      context.mode = "LabelToEOL";
      return createInContextToken({ type: "Label" });
    }
    case "*params": {
      context.mode = "Expression";
      return createInContextToken({ type: "Parameters" });
    }
    case "*hide_reuse": {
      context.mode = "Prose";
      return createInContextToken({ type: "HideReuse" });
    }
    case "*disable_reuse": {
      context.mode = "Prose";
      return createInContextToken({ type: "DisableReuse" });
    }
    case "*allow_reuse": {
      context.mode = "Prose";
      return createInContextToken({ type: "AllowReuse" });
    }
    case "*gosub ": {
      context.mode = "LabelToEOL";
      context.gosubArgs = true;
      return createInContextToken({ type: "GoSub" });
    }
    case "*gosub_scene ": {
      context.mode = "SceneArgToEOL";
      context.gosubArgs = true;
      return createInContextToken({ type: "GoSubScene" });
    }
    case "*return": {
      context.mode = "Prose";
      return createInContextToken({ type: "Return" });
    }
    case "*goto ": {
      context.mode = "LabelToEOL";
      return createInContextToken({ type: "GotoLabel" });
    }
    case "*goto_scene": {
      context.mode = "SceneArgToEOL";
      return createInContextToken({ type: "GotoScene" });
    }
    case "*goto_random_scene": {
      context.mode = "Expression";
      return createInContextToken({ type: "GotoRandomScene" });
    }
    case "*if": {
      if (context.currentLine[context.position + 1] === "i") {
        break;
      }
      context.mode = "Expression";
      return createInContextToken({ type: "If" });
    }
    case "*else if":
    case "*elseif":
    case "*elsif": {
      context.mode = "Expression";
      return createInContextToken({ type: "ElseIf" });
    }
    case "*else\n":
    case "*else ": {
      context.mode = "Expression";
      return createInContextToken({ type: "Else" });
    }
    case "*else": {
      if (context.position + 1 >= context.currentLine.trimEnd().length) {
        context.mode = "Expression";
        return createInContextToken({ type: "Else" });
      }
      break;
    }
    case "*create": {
      if (context.currentLine[context.position + 1] === "_") break;
      context.mode = "Expression";
      return createInContextToken({ type: "CreateVariable" });
    }
    case "*temp": {
      if (context.currentLine[context.position + 1] === "_") break;
      context.mode = "Expression";
      return createInContextToken({ type: "CreateTempVariable" });
    }
    case "*set": {
      context.mode = "Expression";
      return createInContextToken({ type: "SetVariable" });
    }
    case "*choice": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "Choice" });
    }
    case "*fake_choice": {
      context.mode = "Prose";
      return createInContextToken({ type: "FakeChoice" });
    }
    case "*finish": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "Finish" });
    }
    case "*ending":
    case "*delay_ending": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "Ending" });
    }
    case "*bug": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "Bug" });
    }
    case "*stat_chart": {
      context.mode = "StatChart";
      return createInContextToken({ type: "StatChart" });
    }
    case "*line_break": {
      context.mode = "Prose";
      return createInContextToken({ type: "LineBreak" });
    }
    case "*selectable_if": {
      context.mode = "Expression";
      return createInContextToken({ type: "SelectableIf" });
    }
    case "*link": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "Link" });
    }
    case "*comment": {
      context.mode = "Comment";
      return createInContextToken({ type: "Comment" });
    }
    case "*scene_list": {
      context.mode = "SceneList";
      return createInContextToken({ type: "SceneList" });
    }
    case "*achievement": {
      context.mode = "Achievement";
      return createInContextToken({ type: "Achievement" });
    }
    case "*check_achievements": {
      context.mode = "Prose";
      return createInContextToken({ type: "CheckAchievements" });
    }
    case "*achieve ": {
      context.mode = "Expression";
      return createInContextToken({ type: "Achieve" });
    }
    case "*image": {
      context.mode = "Image";
      return createInContextToken({ type: "Image" });
    }
    case "*text_image": {
      context.mode = "Image";
      return createInContextToken({ type: "TextImage" });
    }
    case "*input_number": {
      context.mode = "Expression";
      return createInContextToken({ type: "InputNumber" });
    }
    case "*input_text": {
      context.mode = "Expression";
      return createInContextToken({ type: "InputText" });
    }
    case "*author": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "Author" });
    }
    case "*ifid": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "GameIdentifier" });
    }
    case "*purchase_discount": {
      context.mode = "Prose";
      break;
    }
    case "*page_break_advertisement":
    case "*page_break": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "PageBreak" });
    }
    case "*save_checkpoint": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "SaveCheckpoint" });
    }
    case "*restore_checkpoint": {
      context.mode = "ProseToEOL";
      return createInContextToken({ type: "RestoreCheckpoint" });
    }
    case "*delete": {
      if (context.currentLine[context.position + 1] === "_") break;
      context.mode = "Expression";
      return createInContextToken({ type: "DeleteVariable" });
    }
    case "*rand": {
      context.mode = "Expression";
      return createInContextToken({ type: "GenerateRandom" });
    }
    case "*create_array": {
      context.mode = "Expression";
      return createInContextToken({ type: "CreateArray" });
    }
    case "*temp_array": {
      context.mode = "Expression";
      return createInContextToken({ type: "CreateTempArray" });
    }
    case "*delete_array": {
      context.mode = "Expression";
      return createInContextToken({ type: "DeleteArray" });
    }
  }
  return void 0;
};
var knownCommandsSet = /* @__PURE__ */ new Set([
  "*choice",
  "*fake_choice",
  "*label",
  "*if",
  "*elseif",
  "*elsif",
  "*else if",
  "*else",
  "*finish",
  "*params",
  "*stat_chart",
  "*delete",
  "*set",
  "*create",
  "*temp",
  "*selectable_if",
  "*hide_reuse",
  "*allow_reuse",
  "*disable_reuse",
  "*gosub_scene",
  "*gosub",
  "*goto",
  "*goto_scene",
  "*comment",
  "*ifid",
  "*rand",
  "*line_break",
  "*page_break",
  "*page_break_advertisement",
  "*input_text",
  "*input_number",
  "*ending",
  "*delay_ending",
  "*return",
  "*achievement",
  "*achieve",
  "*check_achievements",
  "*link",
  "*image",
  "*text_image",
  "*purchase_discount",
  "*save_checkpoint",
  "*restore_checkpoint",
  "*create_array",
  "*delete_array",
  "*temp_array",
  "*scene_list",
  "*author"
]);
var isStartOfCommand = (context) => {
  const line = context.currentLine;
  const pos = context.position;
  if (line[pos] !== "*") return false;
  if (pos === 0) return true;
  const intent = countIndentation(line);
  if (pos === intent.position) return true;
  if (pos + 1 >= line.length) return false;
  const nextChar = line[pos + 1];
  if (nextChar === " ") return false;
  if (Number.isInteger(nextChar)) return false;
  const prev = line[pos - 1];
  if (prev !== " " && prev !== "	") return false;
  let endOfCommand = line.indexOf(" ", pos);
  const parenIndex = line.indexOf("(", pos);
  if (endOfCommand === -1 || parenIndex !== -1 && parenIndex < endOfCommand) {
    endOfCommand = parenIndex;
  }
  if (endOfCommand === -1) {
    endOfCommand = line.indexOf(")", pos);
  }
  const possibleCommand = endOfCommand !== -1 ? line.substring(pos, endOfCommand) : line.substring(pos);
  return knownCommandsSet.has(possibleCommand);
};
var isStartOfChoiceOption = (char, before) => {
  return char == "#" && (before === void 0 || (before === " " || before === "	"));
};

// ../scanner/scan-label-names.ts
var scanLabelNames = (scene) => {
  const labels = [];
  const content = scene.content;
  let i = 0;
  while (i < content.length) {
    const nlIdx = content.indexOf("\n", i);
    const lineEnd = nlIdx === -1 ? content.length : nlIdx;
    let lineStart = i;
    while (lineStart < lineEnd && (content[lineStart] === " " || content[lineStart] === "	")) lineStart++;
    if (content.startsWith("*label", lineStart)) {
      let labelStart = lineStart + 6;
      while (labelStart < lineEnd && (content[labelStart] === " " || content[labelStart] === "	")) labelStart++;
      let labelEnd = labelStart;
      while (labelEnd < lineEnd && content[labelEnd] !== " " && content[labelEnd] !== "	") labelEnd++;
      if (labelEnd > labelStart) {
        labels.push(content.substring(labelStart, labelEnd).toLowerCase());
      }
    }
    i = nlIdx === -1 ? content.length : nlIdx + 1;
  }
  return labels;
};

// ../scanner/flatten-prose.ts
var matchOpener = (content, cursor) => {
  const c = content[cursor];
  if (c === "@" && content[cursor + 1] === "{") {
    return { kind: "MultiReplace", length: 2 };
  }
  if (c === "$") {
    if (content[cursor + 1] === "!" && content[cursor + 2] === "!" && content[cursor + 3] === "{") {
      return { kind: "PrintCapitaliseAll", length: 4 };
    }
    if (content[cursor + 1] === "!" && content[cursor + 2] === "{") {
      return { kind: "PrintCapitaliseFirst", length: 3 };
    }
    if (content[cursor + 1] === "{") {
      return { kind: "Print", length: 2 };
    }
  }
  return void 0;
};
var createTracker = (content, base) => ({
  content,
  baseLine: base.lineNumber,
  baseCol: base.position,
  lastOffset: 0,
  line: base.lineNumber,
  col: base.position
});
var trackAt = (t, offset) => {
  if (offset < t.lastOffset) {
    t.lastOffset = 0;
    t.line = t.baseLine;
    t.col = t.baseCol;
  }
  for (let i = t.lastOffset; i < offset && i < t.content.length; i++) {
    if (t.content[i] === "\n") {
      t.line++;
      t.col = t.baseCol;
    } else {
      t.col++;
    }
  }
  t.lastOffset = offset;
  return { lineNumber: t.line, position: t.col };
};
var findMatchingBrace = (content, openCursor) => {
  let depth = 1;
  let i = openCursor;
  let crossesNewline = false;
  while (i < content.length) {
    const c = content[i];
    if (c === "\n") crossesNewline = true;
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return { index: i, crossesNewline };
    }
    i++;
  }
  return { index: -1, crossesNewline };
};
var emitText = (out, content, start, end, base, pos) => {
  if (end <= start) return;
  const p = trackAt(pos, start);
  out.push({
    type: "Prose",
    sceneName: base.sceneName,
    lineNumber: p.lineNumber,
    position: p.position,
    indent: base.indent,
    content: content.substring(start, end)
  });
};
var emitRange = (out, content, rangeStart, rangeEnd, base, pos) => {
  let cursor = rangeStart;
  let textStart = cursor;
  while (cursor < rangeEnd) {
    const opener = matchOpener(content, cursor);
    if (!opener) {
      cursor++;
      continue;
    }
    const openerStart = cursor;
    const bodyStart = cursor + opener.length;
    const braceMatch = findMatchingBrace(content, bodyStart);
    const closeBrace = braceMatch.index;
    const hasClose = closeBrace !== -1 && closeBrace < rangeEnd;
    let bodyEnd;
    let segmentEnd;
    let isMultiLine = false;
    if (hasClose && braceMatch.crossesNewline) {
      isMultiLine = true;
      const newlinePos = content.indexOf("\n", bodyStart);
      bodyEnd = newlinePos !== -1 && newlinePos < closeBrace ? newlinePos : closeBrace;
      segmentEnd = closeBrace + 1;
    } else {
      bodyEnd = hasClose ? closeBrace : rangeEnd;
      segmentEnd = hasClose ? closeBrace + 1 : rangeEnd;
    }
    emitText(out, content, textStart, openerStart, base, pos);
    const openPos = trackAt(pos, openerStart);
    switch (opener.kind) {
      case "Print":
        out.push({
          type: "OpenPrint",
          sceneName: base.sceneName,
          lineNumber: openPos.lineNumber,
          position: openPos.position,
          indent: base.indent
        });
        break;
      case "PrintCapitaliseFirst":
        out.push({
          type: "OpenPrintCapitaliseFirst",
          sceneName: base.sceneName,
          lineNumber: openPos.lineNumber,
          position: openPos.position,
          indent: base.indent
        });
        break;
      case "PrintCapitaliseAll":
        out.push({
          type: "OpenPrintCapitaliseAll",
          sceneName: base.sceneName,
          lineNumber: openPos.lineNumber,
          position: openPos.position,
          indent: base.indent
        });
        break;
      case "MultiReplace":
        out.push({
          type: "OpenMultiReplace",
          sceneName: base.sceneName,
          lineNumber: openPos.lineNumber,
          position: openPos.position,
          indent: base.indent
        });
        break;
    }
    if (opener.kind === "MultiReplace") {
      emitMultiReplaceBody(out, content, bodyStart, bodyEnd, base, pos);
    } else {
      const body = content.substring(bodyStart, bodyEnd);
      const bodyPos = trackAt(pos, bodyStart);
      const exprTokens = tokenizeExpressionString(
        body,
        bodyPos.lineNumber,
        bodyPos.position,
        base.indent,
        base.sceneName,
        base.knownLabels,
        base.sceneNames
      );
      out.push(...exprTokens);
    }
    if (hasClose) {
      const closePos = trackAt(pos, closeBrace);
      out.push({
        type: "CloseBrace",
        sceneName: base.sceneName,
        lineNumber: closePos.lineNumber,
        position: closePos.position,
        indent: base.indent
      });
    }
    cursor = segmentEnd;
    textStart = cursor;
  }
  emitText(out, content, textStart, rangeEnd, base, pos);
};
var emitMultiReplaceBody = (out, content, bodyStart, bodyEnd, base, pos) => {
  let cursor = bodyStart;
  while (cursor < bodyEnd && (content[cursor] === " " || content[cursor] === "	")) {
    cursor++;
  }
  const selectorStart = cursor;
  let depth = 0;
  while (cursor < bodyEnd) {
    const c = content[cursor];
    if (c === '"') {
      cursor++;
      while (cursor < bodyEnd && content[cursor] !== '"') cursor++;
    } else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 0 && (c === " " || c === "	")) break;
    cursor++;
  }
  const selectorEnd = cursor;
  if (selectorEnd > selectorStart) {
    const selectorText = content.substring(selectorStart, selectorEnd);
    const selectorPos = trackAt(pos, selectorStart);
    out.push(
      ...tokenizeExpressionString(
        selectorText,
        selectorPos.lineNumber,
        selectorPos.position,
        base.indent,
        base.sceneName,
        base.knownLabels,
        base.sceneNames
      )
    );
  }
  while (cursor < bodyEnd && (content[cursor] === " " || content[cursor] === "	")) {
    cursor++;
  }
  let altStart = cursor;
  depth = 0;
  while (cursor < bodyEnd) {
    const c = content[cursor];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "|" && depth === 0) {
      emitRange(out, content, altStart, cursor, base, pos);
      const elsePos = trackAt(pos, cursor);
      out.push({
        type: "MultiReplaceElse",
        sceneName: base.sceneName,
        lineNumber: elsePos.lineNumber,
        position: elsePos.position,
        indent: base.indent
      });
      altStart = cursor + 1;
    }
    cursor++;
  }
  emitRange(out, content, altStart, bodyEnd, base, pos);
};
var flattenProse = (content, base) => {
  const out = [];
  const pos = createTracker(content, base);
  emitRange(out, content, 0, content.length, base, pos);
  return out;
};

// ../utils/fnv.ts
var FNV_OFFSET = 2166136261;
var FNV_PRIME = 16777619;
var fnvMixStr = (hash, s) => {
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};
var fnvMixInt = (hash, n) => {
  hash ^= n & 255;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= n >>> 8 & 255;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= n >>> 16 & 255;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= n >>> 24 & 255;
  return Math.imul(hash, FNV_PRIME) >>> 0;
};

// ../scanner/token-hash.ts
var hashToken = (token) => {
  let h = fnvMixStr(FNV_OFFSET, token.type);
  h = fnvMixInt(h, token.indent);
  const t = token;
  if (t.content !== void 0 && typeof t.content === "string") {
    h = fnvMixStr(h, t.content);
  }
  if (t.value !== void 0) {
    h = typeof t.value === "string" ? fnvMixStr(h, t.value) : fnvMixInt(h, typeof t.value === "boolean" ? t.value ? 1 : 0 : t.value);
  }
  if (t.rawValue !== void 0) {
    h = fnvMixStr(h, t.rawValue);
  }
  if (t.rawText !== void 0) {
    h = fnvMixStr(h, t.rawText);
  }
  if (t.expression !== void 0 && Array.isArray(t.expression)) {
    for (const sub of t.expression) {
      if (sub.hash !== void 0) {
        h = fnvMixInt(h, sub.hash);
      }
    }
  }
  return h;
};
var hashTokenLine = (lineTokenHashes) => {
  let h = FNV_OFFSET;
  for (const th of lineTokenHashes) {
    h = fnvMixInt(h, th);
  }
  return h;
};
var hashScene = (lineHashes) => {
  let h = FNV_OFFSET;
  for (const lh of lineHashes) {
    h = fnvMixInt(h, lh);
  }
  return h;
};
var computeSceneHashes = (tokens) => {
  for (const token of tokens) {
    token.hash = hashToken(token);
  }
  const lineMap = /* @__PURE__ */ new Map();
  for (const token of tokens) {
    const line = token.lineNumber;
    let arr = lineMap.get(line);
    if (!arr) {
      arr = [];
      lineMap.set(line, arr);
    }
    arr.push(token.hash);
  }
  const sortedLines = Array.from(lineMap.keys()).sort((a, b) => a - b);
  const lineHashes = [];
  for (const line of sortedLines) {
    lineHashes.push(hashTokenLine(lineMap.get(line)));
  }
  return {
    lineHashes,
    sceneHash: hashScene(lineHashes)
  };
};

// ../parser/expressions/expression-logic.ts
var COMPARISON_FLIP = {
  ">": "<=",
  "<": ">=",
  ">=": "<",
  "<=": ">",
  "=": "!=",
  "!=": "="
};
var COMPARISON_TYPE = {
  ">": "GreaterThanOperator",
  ">=": "GreaterThanEqualsOperator",
  "<": "LessThanOperator",
  "<=": "LessThanEqualsOperator",
  "=": "EqualityOperator",
  "!=": "NotEqualityOperator"
};
var LOGICAL_FLIP = {
  and: "or",
  or: "and"
};
var LOGICAL_TYPE = {
  and: "LogicalAnd",
  or: "LogicalOr"
};
function syntheticToken(base, rawValue) {
  const type = COMPARISON_TYPE[rawValue] ?? LOGICAL_TYPE[rawValue] ?? base.type;
  return { ...base, rawValue, type };
}
function wrapNot(expr) {
  return {
    kind: "Unary",
    operator: { rawValue: "not", type: "NotOperator" },
    value: expr
  };
}
function invertExpression(expr) {
  switch (expr.kind) {
    case "Binary": {
      const b = expr;
      const raw = b.operator.rawValue;
      if (LOGICAL_FLIP[raw]) {
        return {
          kind: "Binary",
          left: invertExpression(b.left),
          right: invertExpression(b.right),
          operator: syntheticToken(b.operator, LOGICAL_FLIP[raw])
        };
      }
      if (COMPARISON_FLIP[raw]) {
        return {
          kind: "Binary",
          left: b.left,
          right: b.right,
          operator: syntheticToken(b.operator, COMPARISON_FLIP[raw])
        };
      }
      return wrapNot(expr);
    }
    case "Unary": {
      const u = expr;
      if (u.operator.rawValue === "not") {
        return u.value;
      }
      return wrapNot(expr);
    }
    case "Grouping": {
      const g = expr;
      return {
        kind: "Grouping",
        expression: invertExpression(g.expression)
      };
    }
    default:
      return wrapNot(expr);
  }
}
function combineWithAnd(expressions) {
  const simplified = simplifyConjunction(expressions);
  if (simplified.length === 1) return simplified[0];
  return simplified.reduce((left, right) => ({
    kind: "Binary",
    left,
    right,
    operator: { rawValue: "and", type: "LogicalAnd" }
  }));
}
function unwrapGrouping(expr) {
  while (expr.kind === "Grouping") expr = expr.expression;
  return expr;
}
function extractBound(expr, index) {
  const inner = unwrapGrouping(expr);
  if (inner.kind !== "Binary") return null;
  const b = inner;
  const op = b.operator.rawValue;
  if (!["<", "<=", ">", ">="].includes(op)) return null;
  const left = unwrapGrouping(b.left);
  const right = unwrapGrouping(b.right);
  if (left.kind !== "Identifier" || right.kind !== "Literal") return null;
  const val = right.value.value;
  if (typeof val !== "number") return null;
  return {
    variable: left.token.value.toLowerCase(),
    op,
    value: val,
    index
  };
}
function isUpperBound(op) {
  return op === "<" || op === "<=";
}
function isLowerBound(op) {
  return op === ">" || op === ">=";
}
function subsumes(a, b) {
  if (a.variable !== b.variable) return false;
  if (isUpperBound(a.op) && isUpperBound(b.op)) {
    if (a.value < b.value) return true;
    if (a.value === b.value && a.op === "<" && b.op === "<=") return true;
  }
  if (isLowerBound(a.op) && isLowerBound(b.op)) {
    if (a.value > b.value) return true;
    if (a.value === b.value && a.op === ">" && b.op === ">=") return true;
  }
  return false;
}
function simplifyConjunction(exprs) {
  const bounds = [];
  for (let i = 0; i < exprs.length; i++) {
    const b = extractBound(exprs[i], i);
    if (b) bounds.push(b);
  }
  const removed = /* @__PURE__ */ new Set();
  for (const a of bounds) {
    for (const b of bounds) {
      if (a.index !== b.index && !removed.has(a.index) && subsumes(a, b)) {
        removed.add(b.index);
      }
    }
  }
  if (removed.size === 0) return exprs;
  return exprs.filter((_, i) => !removed.has(i));
}

// ../parser/merkle-hash.ts
var FNV_OFFSET_2 = 391068499;
var MerkleHasher = class {
  h1 = FNV_OFFSET;
  h2 = FNV_OFFSET_2;
  feed(s) {
    this.h1 = fnvMixStr(this.h1, s);
    this.h2 = fnvMixStr(this.h2, s);
    return this;
  }
  feedChild(child) {
    return this.feed(child.statementId);
  }
  feedChildren(children) {
    for (const child of children) {
      this.feed(child.statementId);
    }
    return this;
  }
  digest() {
    return (this.h1 >>> 0).toString(36) + (this.h2 >>> 0).toString(36);
  }
};
var merkle = (kind) => new MerkleHasher().feed(kind).feed("\0");
var hashStatement = (stmt) => {
  const h = merkle(stmt.kind);
  hashOwnContent(h, stmt);
  hashChildBodies(h, stmt);
  return h.digest();
};
var hashOwnContent = (h, stmt) => {
  if (stmt.token) {
    if (stmt.token.hash !== void 0) h.feed(`#${stmt.token.hash}`);
    else if (stmt.token.value !== void 0) h.feed(String(stmt.token.value));
    if (stmt.token.lineNumber !== void 0) h.feed(`@${stmt.token.lineNumber}`);
  }
  if (stmt.variable?.value) h.feed(`var:${stmt.variable.value}`);
  if (stmt.label?.value) h.feed(`lbl:${stmt.label.value}`);
  if (stmt.codename?.value) h.feed(`cn:${stmt.codename.value}`);
  if (stmt.identifier?.value) h.feed(`id:${stmt.identifier.value}`);
  if (stmt.identifiers && Array.isArray(stmt.identifiers)) {
    for (const id of stmt.identifiers) {
      if (id?.value) h.feed(`id:${id.value}`);
    }
  }
  if (stmt.storeInto?.value) h.feed(`si:${stmt.storeInto.value}`);
  if (stmt.sceneName) h.feed(`sn:${stmt.sceneName}`);
  if (stmt.expression) hashExpression(h, stmt.expression);
  if (stmt.assignment) hashExpression(h, stmt.assignment);
  if (stmt.selectableIf) hashExpression(h, stmt.selectableIf);
  if (stmt.min) hashExpression(h, stmt.min);
  if (stmt.max) hashExpression(h, stmt.max);
  if (stmt.content !== void 0 && typeof stmt.content === "string") {
    h.feed(`c:${stmt.content}`);
  }
  if (stmt.parsedSegments) {
    for (const seg of stmt.parsedSegments) {
      h.feed(seg.kind);
      if (seg.text) h.feed(seg.text);
      if (seg.expression) hashExpression(h, seg.expression);
      if (seg.selector) hashExpression(h, seg.selector);
      if (seg.alternatives) {
        for (const alt of seg.alternatives) {
          if (alt.segments) {
            for (const s of alt.segments) {
              h.feed(s.kind);
              if (s.text) h.feed(s.text);
              if (s.expression) hashExpression(h, s.expression);
            }
          }
        }
      }
    }
  }
};
var hashExpression = (h, expr) => {
  if (!expr) return;
  if (expr.kind) h.feed(expr.kind);
  if (expr.token?.value !== void 0) h.feed(String(expr.token.value));
  if (expr.operator?.rawValue) h.feed(expr.operator.rawValue);
  if (expr.value !== void 0 && typeof expr.value !== "object") h.feed(String(expr.value));
  if (expr.left) hashExpression(h, expr.left);
  if (expr.right) hashExpression(h, expr.right);
  if (expr.expression) hashExpression(h, expr.expression);
  if (expr.value && typeof expr.value === "object") hashExpression(h, expr.value);
  if (expr.identifier?.value) h.feed(expr.identifier.value);
};
var hashChildBodies = (h, stmt) => {
  if (stmt.body && Array.isArray(stmt.body)) h.feedChildren(stmt.body);
  if (stmt.elseIfBranches && Array.isArray(stmt.elseIfBranches)) h.feedChildren(stmt.elseIfBranches);
  if (stmt.elseBranch) h.feedChild(stmt.elseBranch);
  if (stmt.options && Array.isArray(stmt.options)) h.feedChildren(stmt.options);
  if (stmt.declarations && Array.isArray(stmt.declarations)) h.feedChildren(stmt.declarations);
  if (stmt.args && Array.isArray(stmt.args)) {
    for (const arg of stmt.args) {
      if (arg && typeof arg === "object" && arg.kind) hashExpression(h, arg);
    }
  }
};

// ../parser/parser.ts
var ParseErrorSignal = class extends Error {
  parseError;
  constructor(parseError) {
    super(parseError.message);
    this.parseError = parseError;
    this.name = "ParseErrorSignal";
  }
};
var choiceScopeOnlyTokenTypes = /* @__PURE__ */ new Set([
  "ChoiceOption",
  "SelectableIf"
]);
var startupHeaderStatements = /* @__PURE__ */ new Set([
  "DeclareVariable",
  "DeclareArray",
  "Author",
  "SceneList",
  "GameIdentifier",
  "Comment",
  "Achievement",
  "Prose"
]);
var Parser = class {
  tokens;
  current;
  errors;
  contextStack;
  seenNonHeaderStatement = false;
  sceneName = null;
  options;
  constructor(tokens, options) {
    this.tokens = tokens;
    this.current = 0;
    this.errors = [];
    this.contextStack = [];
    this.options = options ?? {};
  }
  withContext(ctx, f) {
    this.contextStack.push(ctx);
    try {
      return f();
    } finally {
      this.contextStack.pop();
    }
  }
  check(type, sameLine = false, sameIndent = false) {
    if (this.isAtEnd()) return false;
    if (sameLine && !this.peekSameLine()) return false;
    if (sameIndent && !this.peekSameIndent(this.previous()?.indent ?? 0))
      return false;
    const peek = this.peek();
    return peek.type == type;
  }
  advance() {
    const old = this.previous();
    const newToken = this.peek();
    if (!this.isAtEnd()) this.current++;
    return newToken;
  }
  isAtEnd() {
    const peek = this.peek()?.type;
    return peek == null || peek == "SceneEnd";
  }
  peek() {
    return this.tokens[this.current];
  }
  peekSameLine() {
    const peek = this.peek();
    if (peek === null || peek === void 0) return false;
    return peek.lineNumber == (this.previous()?.lineNumber ?? 0);
  }
  peekSameIndent(desiredIndent) {
    const peek = this.peek();
    if (peek === null || peek === void 0) return false;
    return peek.indent == desiredIndent;
  }
  peekGreaterIndent(desiredIndent) {
    const peek = this.peek();
    if (peek === null || peek === void 0) return false;
    return peek.indent > desiredIndent;
  }
  peekLessIndent(desiredIndent) {
    const peek = this.peek();
    if (peek === null || peek === void 0) return false;
    return peek.indent < desiredIndent;
  }
  childScope(indent) {
    return !this.peekSameIndent(indent) && !this.peekLessIndent(indent);
  }
  siblingScope(indent) {
    return !this.peekLessIndent(indent) && !this.peekGreaterIndent(indent);
  }
  previous() {
    return this.tokens[this.current - 1];
  }
  match(typesToMatch, sameLine = true, sameIndent = true) {
    for (const tokenType of typesToMatch) {
      if (this.check(tokenType, sameLine, sameIndent)) {
        this.advance();
        return true;
      }
    }
    return false;
  }
  consume(type, message, sameLine = true, sameIndent = true) {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }
  consumeOneOf(type, message, sameLine = true, sameIndent = true) {
    for (const t of type) {
      if (this.check(t)) return this.advance();
    }
    throw this.error(this.peek(), message);
  }
  error(token, message) {
    const location = token.type == "SceneEnd" ? `at end of scene ${token.sceneName}:${token.lineNumber}:${token.position}[Indent ${token.indent}]` : `at '${token.type}' ${token.sceneName}:${token.lineNumber}:${token.position}[Indent ${token.indent}, Id: ${token.id}]`;
    const fullMessage = `${message} ${location}`;
    const parseError = {
      token,
      message: fullMessage,
      context: [...this.contextStack]
    };
    this.errors.push(parseError);
    return new ParseErrorSignal(parseError);
  }
  expectIndentChange() {
    if (!this.peekSameIndent(this.previous()?.indent ?? 0)) return;
    const peek = this.peek();
    throw this.error(
      peek,
      `Expected change in indentation, found ${peek.type} instead at ${peek.lineNumber}:${peek.position} with indentation ${peek.indent}`
    );
  }
  expectLineChange() {
    if (!this.peekSameLine()) return;
    const peek = this.peek();
    throw this.error(
      peek,
      `Expected end of statement, found ${peek.type} instead at ${peek.lineNumber}:${peek.position}`
    );
  }
  expression() {
    return this.logical();
  }
  logical() {
    let expr = this.equality();
    while (this.match(["LogicalAnd", "LogicalOr"])) {
      const operator = this.previous();
      const right = this.equality();
      expr = { kind: "Binary", left: expr, operator, right };
    }
    return expr;
  }
  equality() {
    let expr = this.comparison();
    while (this.match(["NotEqualityOperator", "EqualityOperator"])) {
      const operator = this.previous();
      const right = this.comparison();
      expr = { kind: "Binary", left: expr, operator, right };
    }
    return expr;
  }
  comparison() {
    let expr = this.term();
    while (this.match([
      "GreaterThanOperator",
      "GreaterThanEqualsOperator",
      "LessThanOperator",
      "LessThanEqualsOperator",
      "EqualityOperator",
      "NotEqualityOperator"
    ])) {
      const operator = this.previous();
      const right = this.term();
      expr = { kind: "Binary", left: expr, operator, right };
    }
    return expr;
  }
  term(inConcat = false) {
    let expr = this.factor();
    while (this.match([
      "SubtractionOperator",
      "AdditionOperator",
      "ConcatenationOperator",
      "FairmathAdditionOperator",
      "FairmathSubtractionOperator"
    ])) {
      const operator = this.previous();
      if (operator.type === "ConcatenationOperator" && inConcat && !operator.synthetic) {
        this.error(operator, "Concatenation (&) is strictly binary \u2014 use parentheses to group multiple concatenations");
      }
      const isConcat = operator.type === "ConcatenationOperator" && !operator.synthetic;
      const right = this.term(isConcat);
      expr = { kind: "Binary", left: expr, operator, right };
    }
    return expr;
  }
  factor() {
    let expr = this.indexing();
    while (this.match([
      "DivisionOperator",
      "MultiplicationOperator",
      "ModulusOperator"
    ])) {
      const operator = this.previous();
      const right = this.indexing();
      expr = { kind: "Binary", left: expr, operator, right };
    }
    return expr;
  }
  indexing() {
    let expr = this.unary();
    while (this.match(["Indexer", "StringIndexerOperator"])) {
      const operator = this.previous();
      const right = this.unary();
      expr = { kind: "Binary", left: expr, operator, right };
    }
    return expr;
  }
  unary() {
    if (this.match([
      "NotOperator",
      "SubtractionOperator",
      "AdditionOperator",
      "FairmathAdditionOperator",
      "FairmathSubtractionOperator",
      "RoundOperator",
      "LengthOperator"
    ])) {
      const operator = this.previous();
      const right = this.unary();
      return { kind: "Unary", operator, value: right };
    }
    return this.primary();
  }
  primary() {
    if (this.match(["NumberLiteral", "StringLiteral", "BooleanLiteral"])) {
      return { kind: "Literal", value: this.previous() };
    }
    if (this.match(["Identifier"])) {
      const identifier = this.previous();
      if (this.match(["OpenSquareBracket"])) {
        const accessExpression = this.expression();
        this.consume(
          "CloseSquareBracket",
          "Expect ']' after accessor expression"
        );
        return {
          kind: "ArrayIndexer",
          expression: accessExpression,
          identifier
        };
      }
      return { kind: "Identifier", token: identifier };
    }
    if (this.match(["OpenParenthesis"])) {
      const expr = this.expression();
      this.consume("CloseParenthesis", "Expect ')' after expression.");
      return { kind: "Grouping", expression: expr };
    }
    if (this.match(["OpenBrace"])) {
      const expr = this.expression();
      this.consume("CloseBrace", "Expect '}' after dereference expression.");
      return { kind: "Dereference", expression: expr };
    }
    throw this.error(this.peek(), "Expect expression");
  }
  parseExpressionFromTokens(tokens) {
    const savedTokens = this.tokens;
    const savedCurrent = this.current;
    const sentinel = {
      type: "SceneEnd",
      sceneName: tokens[0]?.sceneName ?? "",
      lineNumber: tokens[tokens.length - 1]?.lineNumber ?? 0,
      position: tokens[tokens.length - 1]?.position ?? 0,
      indent: tokens[tokens.length - 1]?.indent ?? 0
    };
    this.tokens = [...tokens, sentinel];
    this.current = 0;
    try {
      return this.expression();
    } finally {
      this.tokens = savedTokens;
      this.current = savedCurrent;
    }
  }
  recoverInto(body, e) {
    if (!(e instanceof ParseErrorSignal)) throw e;
    body.push(this.assignStatementId({
      kind: "Error",
      token: e.parseError.token,
      message: e.parseError.message
    }));
    this.synchronize();
  }
  currentLabel = "_entry";
  assignStatementId(stmt) {
    return Object.assign(stmt, {
      statementId: hashStatement(stmt)
    });
  }
  parseScene() {
    if (this.match(["SceneStart"], false, false)) {
      const sceneStart = this.previous();
      this.sceneName = sceneStart.sceneName;
      return this.withContext({ kind: `Scene '${sceneStart.sceneName}'`, token: sceneStart }, () => {
        const statements = [];
        while (!this.isAtEnd() && !this.match(["SceneEnd"], false, false)) {
          try {
            statements.push(this.statement());
          } catch (e) {
            this.recoverInto(statements, e);
          }
        }
        const sceneEnd = this.previous();
        return {
          name: sceneStart.sceneName,
          statements,
          parseErrors: this.errors,
          start: sceneStart,
          end: sceneEnd
        };
      });
    }
    return null;
  }
  statementDispatch = [
    ["Prose", () => this.proseStatement()],
    ["Choice", () => this.choiceStatement()],
    ["FakeChoice", () => this.fakeChoiceStatement()],
    ["If", () => this.ifStatement()],
    ["GotoLabel", () => this.gotoLabel()],
    ["GotoScene", () => this.gotoScene()],
    ["Label", () => this.labelDefinition()],
    ["PageBreak", () => this.pageBreak()],
    ["LineBreak", () => this.lineBreak()],
    ["SetVariable", () => this.setVariable()],
    ["CreateVariable", () => this.createVariable(false)],
    ["CreateTempVariable", () => this.createVariable(true)],
    ["CreateArray", () => this.createArray(false)],
    ["CreateTempArray", () => this.createArray(true)],
    ["DeleteVariable", () => this.deleteVariable()],
    ["DeleteArray", () => this.deleteArray()],
    ["Image", () => this.imageStatement()],
    ["TextImage", () => this.textImageStatement()],
    ["GoSub", () => this.goSub()],
    ["Finish", () => this.finishStatement()],
    ["GoSubScene", () => this.goSubScene()],
    ["Return", () => this.return()],
    ["Comment", () => this.commentBlock()],
    ["Ending", () => this.endingStatement()],
    ["Bug", () => this.bugStatement()],
    ["Author", () => this.authorStatement()],
    ["SceneList", () => this.sceneList()],
    ["Achievement", () => this.achievementDefinition()],
    ["Achieve", () => this.achieveStatement()],
    ["CheckAchievements", () => this.checkAchievementsStatement()],
    ["Link", () => this.linkStatement()],
    ["GenerateRandom", () => this.generateRandomStatement()],
    ["InputText", () => this.inputText()],
    ["InputNumber", () => this.inputNumber()],
    ["Parameters", () => this.parametersStatement()],
    ["StatChart", () => this.statChart()],
    ["GameIdentifier", () => this.gameIdentifierStatement()],
    ["SaveCheckpoint", () => this.saveCheckpointStatement()],
    ["RestoreCheckpoint", () => this.restoreCheckpointStatement()],
    ["HideReuse", () => this.hideReuse()],
    ["DisableReuse", () => this.disableReuse()],
    ["AllowReuse", () => this.allowReuse()]
  ];
  statement() {
    for (const [tokenType, fn] of this.statementDispatch) {
      if (this.match([tokenType], false, false)) {
        const stmt = this.withContext({ kind: tokenType, token: this.previous() }, fn);
        if (!startupHeaderStatements.has(stmt.kind)) {
          this.seenNonHeaderStatement = true;
        }
        return stmt;
      }
    }
    if (this.match(["Else"], false, false)) {
      this.error(this.previous(), "Dangling *else with no related *if");
      return this.withContext({ kind: "Else", token: this.previous() }, () => this.elseStatement());
    }
    const peek = this.peek();
    if (peek !== void 0 && choiceScopeOnlyTokenTypes.has(peek.type)) {
      throw this.error(
        peek,
        `'${peek.type}' is only valid at choice scope (inside *choice or *fake_choice). Found at indent ${peek.indent}.`
      );
    }
    throw this.error(
      peek,
      `Unknown statement starting with ${peek?.type}`
    );
  }
  restoreCheckpointStatement() {
    const token = this.previous();
    let identifier = void 0;
    if (this.peekSameLine()) {
      identifier = this.consumeProseLiteral("Expect identifier for checkpoint after *restore_checkpoint");
    }
    return this.assignStatementId({
      kind: "RestoreCheckpoint",
      token,
      identifier
    });
  }
  saveCheckpointStatement() {
    const token = this.previous();
    let identifier = void 0;
    if (this.peekSameLine()) {
      identifier = this.consumeProseLiteral("Expect identifier for checkpoint after *save_checkpoint");
    }
    return this.assignStatementId({
      kind: "SaveCheckpoint",
      token,
      identifier
    });
  }
  gameIdentifierStatement() {
    const token = this.previous();
    const id = this.consumeProseLiteral("Expect identifier uuid following *ifid");
    return this.assignStatementId({
      kind: "GameIdentifier",
      token,
      uuid: id
    });
  }
  imageStatement() {
    const token = this.previous();
    const path = this.consumeProseValue("Expect path after *image.");
    let alignment = void 0;
    let altText = void 0;
    if (this.peekSameLine()) {
      alignment = this.consume("Identifier", "Expect alignment after image path.", true, true);
      if (this.peekSameLine()) {
        altText = this.consumeProseValue("Expect alt text after image alignement.");
      }
    }
    return this.assignStatementId({
      kind: "Image",
      token,
      path,
      alignment,
      altText
    });
  }
  textImageStatement() {
    const token = this.previous();
    const path = this.consumeProseValue("Expect path after *text_image.");
    let alignment = void 0;
    let altText = void 0;
    if (this.peekSameLine()) {
      alignment = this.consume("Identifier", "Expect alignment after text_image path.", true, true);
      if (this.peekSameLine()) {
        altText = this.consumeProseValue("Expect alt text after text_image alignment.");
      }
    }
    return this.assignStatementId({
      kind: "TextImage",
      token,
      path,
      alignment,
      altText
    });
  }
  statChart() {
    const token = this.previous();
    const stats = [];
    let title = void 0;
    if (this.peekSameLine() && this.check("Prose")) {
      title = this.matchProseValue();
    }
    while (this.childScope(token.indent)) {
      try {
        if (this.match(["Identifier"], false, false)) {
          const type = this.previous();
          const identifier = this.consume(
            "Identifier",
            "Expect variable name for stat entry"
          );
          let displayName = void 0;
          if (this.peekSameIndent(type.indent) && this.check("Prose")) {
            displayName = this.matchProseValue();
          }
          if (type.value === "text") {
            stats.push({
              kind: "Text",
              token: type,
              variable: identifier,
              displayName
            });
            continue;
          }
          if (type.value === "percent") {
            stats.push({
              kind: "Percent",
              variable: identifier,
              displayName
            });
            continue;
          }
          let opposedDisplayName = void 0;
          if (this.peekGreaterIndent(type.indent) && this.check("Prose")) {
            opposedDisplayName = this.matchProseValue();
          }
          if (displayName === void 0 && this.peekGreaterIndent(type.indent) && this.check("Prose")) {
            const temp = this.matchProseValue();
            displayName = opposedDisplayName;
            opposedDisplayName = temp;
          }
          stats.push({
            kind: "OpposedPair",
            token,
            variable: identifier,
            displayName,
            opposingDisplayName: opposedDisplayName
          });
        }
      } catch (e) {
        if (!(e instanceof ParseErrorSignal)) throw e;
        this.synchronize();
      }
    }
    return this.assignStatementId({
      kind: "StatChart",
      token,
      title,
      stats
    });
  }
  parametersStatement() {
    const token = this.previous();
    const identifiers = [];
    while (this.peekSameLine()) {
      identifiers.push(
        this.consume(
          "Identifier",
          "Expect identifier following *params statement",
          true,
          true
        )
      );
    }
    return this.assignStatementId({
      kind: "Parameters",
      token,
      identifiers
    });
  }
  generateRandomStatement() {
    const token = this.previous();
    const identifier = this.consume(
      "Identifier",
      "Expect variable name to store random number.",
      true,
      true
    );
    const min = this.expression();
    const max = this.expression();
    this.expectLineChange();
    return this.assignStatementId({
      kind: "GenerateRandom",
      token,
      identifier,
      min,
      max
    });
  }
  linkStatement() {
    const token = this.previous();
    let url = null;
    if (this.peekSameLine()) {
      url = this.consumeProseValue("Expect URL after Link.");
    }
    this.expectLineChange();
    return this.assignStatementId({ kind: "Link", token, url });
  }
  checkAchievementsStatement() {
    const token = this.previous();
    this.expectLineChange();
    return this.assignStatementId({
      kind: "CheckAchievements",
      token
    });
  }
  achieveStatement() {
    const token = this.previous();
    const codename = this.consume(
      "Identifier",
      "Expect achievement codename."
    );
    this.expectLineChange();
    return this.assignStatementId({
      kind: "Achieve",
      token,
      codename
    });
  }
  achievementDefinition() {
    const token = this.previous();
    const codename = this.consume(
      "Identifier",
      "Expect achievement codename."
    );
    const visibility = this.consume(
      "Identifier",
      "Expect achievement visibility."
    );
    const points = this.consume(
      "NumberLiteral",
      "Expect achievement points."
    );
    const title = this.consumeProseLiteral("Expect achievement title.");
    let preDescription = null;
    if (this.match(["Identifier"], false, false)) {
      preDescription = this.previous();
    } else if (this.check("Prose")) {
      preDescription = this.consumeProseLiteral("Expect achievement description.");
    }
    const postDescription = this.consumeProseLiteral("Expect unlocked achievement description.");
    return this.assignStatementId({
      kind: "Achievement",
      token,
      codename,
      visibility,
      title,
      preDescription,
      postDescription,
      hidden: visibility.value === "hidden"
    });
  }
  sceneList() {
    const token = this.previous();
    const identifiers = [];
    while (this.childScope(token.indent)) {
      const paid = this.match(["Dollar"], false, false);
      const id = this.consume(
        "Identifier",
        "Expect scene identifier in scene list.",
        false,
        false
      );
      identifiers.push({ paid, ...id });
    }
    return this.assignStatementId({
      kind: "SceneList",
      token,
      identifiers
    });
  }
  authorStatement() {
    const token = this.previous();
    const name = this.consumeProseLiteral("Expect author name.");
    this.expectLineChange();
    return this.assignStatementId({
      kind: "Author",
      token,
      value: name
    });
  }
  commentBlock() {
    const collectedComments = [];
    while (this.match(["Comment"], false, true)) {
      const comment = this.previous();
      collectedComments.push(comment);
    }
    return this.assignStatementId({ content: collectedComments, kind: "Comment" });
  }
  return() {
    const token = this.previous();
    this.expectLineChange();
    return this.assignStatementId({
      kind: "Return",
      token
    });
  }
  parseLabel() {
    if (this.peek().type != "Identifier") {
      return this.expression();
    }
    return this.consume(
      "Identifier",
      "Expect valid label name"
    );
  }
  goSubScene() {
    const token = this.previous();
    const scene = this.consume("Identifier", "Expect scene name.");
    let label;
    if (this.peekSameLine()) {
      label = this.parseLabel();
    }
    const args = [];
    while (this.peekSameLine()) {
      args.push(this.expression());
    }
    this.expectLineChange();
    return this.assignStatementId({
      kind: "GoSubScene",
      token,
      scene,
      label,
      args
    });
  }
  goSub() {
    const token = this.previous();
    const label = this.parseLabel();
    const args = [];
    while (this.peekSameLine()) {
      args.push(this.expression());
    }
    this.expectLineChange();
    return this.assignStatementId({
      kind: "GoSub",
      token,
      label,
      args
    });
  }
  inputNumber() {
    const token = this.previous();
    const variable = this.consume(
      "Identifier",
      "Expect variable name to store input text."
    );
    const min = this.expression();
    const max = this.expression();
    this.expectLineChange();
    return this.assignStatementId({
      kind: "InputNumber",
      token,
      storeInto: variable,
      min,
      max
    });
  }
  inputText() {
    const token = this.previous();
    const variable = this.consume(
      "Identifier",
      "Expect variable name to store input text."
    );
    this.expectLineChange();
    return this.assignStatementId({
      kind: "InputText",
      token,
      storeInto: variable
    });
  }
  gotoScene() {
    const token = this.previous();
    let scene;
    if (this.peek().type !== "Identifier") {
      scene = this.parseLabel();
    } else {
      scene = this.consume(
        "Identifier",
        "Expect scene name."
      );
    }
    let label;
    if (this.peekSameLine()) {
      label = this.parseLabel();
    }
    this.expectLineChange();
    return this.assignStatementId({
      kind: "GotoScene",
      token,
      scene,
      label
    });
  }
  lineBreak() {
    const token = this.previous();
    return this.assignStatementId({
      kind: "LineBreak",
      token
    });
  }
  pageBreak() {
    const token = this.previous();
    let buttonText = null;
    if (this.peekSameLine()) {
      const anchor = this.consume("Prose", "Expect button text after page break.");
      buttonText = this.proseValueFrom(anchor, true);
    }
    this.expectLineChange();
    return this.assignStatementId({
      kind: "PageBreak",
      token,
      buttonText
    });
  }
  choiceBoundedifStatement() {
    const parser = () => {
      if (this.match(
        [
          "ChoiceOption",
          "AllowReuse",
          "HideReuse",
          "DisableReuse",
          "SelectableIf"
        ],
        false,
        false
      )) {
        return this.choiceOptionWithModifiers();
      }
      if (this.match(["If"], false, false)) {
        return this.choiceBoundedifStatement();
      }
      return this.statement();
    };
    return this.ifStatement(parser);
  }
  ifStatement(bodyParser = () => this.statement()) {
    const token = this.previous();
    const expression = this.expression();
    const body = [];
    while (this.childScope(token.indent) || this.peekSameLine()) {
      try {
        body.push(bodyParser());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    const elseIfBranches = [];
    while (this.siblingScope(token.indent) && this.match(["ElseIf"], false, false)) {
      const branch = this.elseIfStatement(bodyParser);
      if (this.options.computeConditionHints) {
        const priorConditions = [expression, ...elseIfBranches.map((b) => b.expression)];
        const invertedPriors = combineWithAnd(priorConditions.map(invertExpression));
        branch.effectiveCondition = combineWithAnd([invertedPriors, branch.expression]);
      }
      elseIfBranches.push(branch);
    }
    let elseBranch = null;
    if (this.siblingScope(token.indent) && this.match(["Else"], false, false)) {
      elseBranch = this.elseStatement(bodyParser);
      if (this.options.computeConditionHints) {
        const allConditions = [expression, ...elseIfBranches.map((b) => b.expression)];
        elseBranch.invertedCondition = combineWithAnd(allConditions.map(invertExpression));
      }
    }
    return this.assignStatementId({
      kind: "If",
      token,
      body,
      expression,
      elseBranch,
      elseIfBranches
    });
  }
  elseStatement(bodyParser = () => this.statement()) {
    const token = this.previous();
    const body = [];
    while (this.childScope(token.indent)) {
      try {
        body.push(bodyParser());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    return this.assignStatementId({
      kind: "Else",
      token,
      body
    });
  }
  elseIfStatement(bodyParser = () => this.statement()) {
    const token = this.previous();
    const expression = this.expression();
    const body = [];
    while (this.childScope(token.indent)) {
      try {
        body.push(bodyParser());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    return this.assignStatementId({
      kind: "ElseIf",
      token,
      body,
      expression
    });
  }
  finishStatement() {
    const token = this.previous();
    let prose = null;
    if (this.check("Prose", true, true)) {
      prose = this.matchProseValue() ?? null;
    }
    return this.assignStatementId({
      kind: "Finish",
      token,
      buttonText: prose
    });
  }
  endingStatement() {
    const token = this.previous();
    let prose = null;
    if (this.check("Prose", true, true)) {
      prose = this.matchProseValue() ?? null;
    }
    return this.assignStatementId({
      kind: "Ending",
      token,
      buttonText: prose
    });
  }
  bugStatement() {
    const token = this.previous();
    let message = null;
    if (this.check("Prose", true, true)) {
      message = this.matchProseValue() ?? null;
    }
    return this.assignStatementId({
      kind: "Bug",
      token,
      message
    });
  }
  choiceStatement() {
    const token = this.previous();
    const body = [];
    const noteTokens = [];
    while (this.peekSameLine()) {
      noteTokens.push(
        this.consumeProseValue("Note elements on same line after choice")
      );
    }
    while (this.childScope(token.indent)) {
      try {
        if (this.match(
          [
            "ChoiceOption",
            "AllowReuse",
            "DisableReuse",
            "HideReuse",
            "SelectableIf"
          ],
          false,
          false
        )) {
          body.push(this.choiceOptionWithModifiers());
        } else if (this.match(["If"], false, false)) {
          body.push(this.choiceBoundedifStatement());
        } else if (this.match(["Prose"], false, false)) {
          throw this.error(
            this.previous(),
            "Prose is not allowed directly inside Choice statements."
          );
        } else if (this.match(["Comment"], false, false)) {
          body.push(this.commentBlock());
        }
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    return this.assignStatementId({
      kind: "Choice",
      token,
      body
    });
  }
  fakeChoiceStatement() {
    const token = this.previous();
    const body = [];
    while (this.childScope(token.indent)) {
      try {
        if (this.match(
          [
            "ChoiceOption",
            "AllowReuse",
            "DisableReuse",
            "HideReuse",
            "SelectableIf"
          ],
          false,
          false
        )) {
          body.push(this.choiceOptionWithModifiers());
        } else if (this.match(["If"], false, false)) {
          body.push(this.choiceBoundedifStatement());
        } else if (this.match(["Label"], false, false)) {
          body.push(this.labelDefinition());
        } else if (this.match(["Prose"], false, false)) {
          throw this.error(
            this.previous(),
            "Prose is not allowed directly inside Choice statements."
          );
        } else if (this.match(["Comment"], false, false)) {
          body.push(this.commentBlock());
        }
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    return this.assignStatementId({
      kind: "FakeChoice",
      token,
      body
    });
  }
  gotoLabel() {
    const token = this.previous();
    const label = this.parseLabel();
    this.expectLineChange();
    return this.assignStatementId({
      kind: "GotoLabel",
      token,
      label
    });
  }
  labelDefinition() {
    const token = this.previous();
    const label = this.consume("Identifier", "Expect label name.");
    this.expectLineChange();
    const labelName = label?.value ?? "unknown";
    this.currentLabel = labelName;
    return this.assignStatementId({
      kind: "Label",
      token,
      label
    });
  }
  selectableIf() {
    const token = this.previous();
    const expression = this.expression();
    return this.assignStatementId({
      kind: "SelectableIf",
      token,
      expression
    });
  }
  choiceOptionWithModifiers() {
    const token = this.previous();
    const modififers = [];
    switch (token.type) {
      case "AllowReuse": {
        modififers.push(this.allowReuse());
        break;
      }
      case "DisableReuse": {
        modififers.push(this.disableReuse());
        break;
      }
      case "HideReuse": {
        modififers.push(this.hideReuse());
        break;
      }
      case "SelectableIf": {
        modififers.push(this.selectableIf());
        break;
      }
      case "ChoiceOption": {
        return this.choiceOption(modififers);
      }
    }
    const rejectReuseAfterSelectableIf = () => {
      if (modififers.some((m) => m.kind === "SelectableIf")) {
        this.error(
          this.previous(),
          "Reuse modifiers (*hide_reuse, *disable_reuse, *allow_reuse) must appear before *selectable_if on a choice option."
        );
      }
    };
    while (true) {
      if (this.match(["AllowReuse"], false, false)) {
        rejectReuseAfterSelectableIf();
        modififers.push(this.allowReuse());
      } else if (this.match(["DisableReuse"], false, false)) {
        rejectReuseAfterSelectableIf();
        modififers.push(this.disableReuse());
      } else if (this.match(["HideReuse"], false, false)) {
        rejectReuseAfterSelectableIf();
        modififers.push(this.hideReuse());
      } else if (this.match(["SelectableIf"], false, false)) {
        modififers.push(this.selectableIf());
      } else if (this.match(["ChoiceOption"], false, false)) {
        return this.choiceOption(modififers);
      } else if (this.match(["If"], true, true)) {
        return this.choiceBoundedifStatement();
      } else {
        break;
      }
    }
    throw this.error(token, "Expect ChoiceOption after modifiers.");
  }
  hideReuse() {
    const token = this.previous();
    return this.assignStatementId({
      kind: "HideReuse",
      token
    });
  }
  disableReuse() {
    const token = this.previous();
    return this.assignStatementId({
      kind: "DisableReuse",
      token
    });
  }
  allowReuse() {
    const token = this.previous();
    return this.assignStatementId({
      kind: "AllowReuse",
      token
    });
  }
  choiceOption(modifiers = []) {
    const token = this.previous();
    const body = [];
    const parsedSegments = [];
    const proseAccumulator = [];
    this.collectProseSegments(parsedSegments, proseAccumulator, token.indent);
    while (this.childScope(token.indent)) {
      try {
        if (this.match(["ChoiceOption"], false, false)) {
          body.push(this.choiceOptionWithModifiers());
          continue;
        }
        if (this.match(["If"], false, false)) {
          body.push(this.choiceBoundedifStatement());
          continue;
        }
        body.push(this.statement());
      } catch (e) {
        this.recoverInto(body, e);
      }
    }
    const disableReuse = modifiers.find(
      (m) => m.kind === "DisableReuse"
    ) !== void 0 ? true : false;
    const hideReuse = modifiers.find((m) => m.kind === "HideReuse") !== void 0 ? true : false;
    const allowReuse = modifiers.find(
      (m) => m.kind === "AllowReuse"
    ) !== void 0 ? true : false;
    const selectableIf = modifiers.find(
      (m) => m.kind === "SelectableIf"
    )?.expression ?? null;
    return this.assignStatementId({
      kind: "ChoiceOption",
      token,
      body,
      parsedSegments,
      reuse: disableReuse ? "disable_reuse" : hideReuse ? "hide_reuse" : allowReuse ? "allow_reuse" : null,
      selectableIf
    });
  }
  proseStatement() {
    const startToken = this.previous();
    const content = [startToken];
    const parsedSegments = [];
    this.appendTextSegment(parsedSegments, startToken);
    this.collectProseSegments(parsedSegments, content, startToken.indent);
    return this.assignStatementId({
      content,
      kind: "Prose",
      parsedSegments
    });
  }
  consumeProseValue(message) {
    const anchor = this.consume("Prose", message);
    return this.proseValueFrom(anchor);
  }
  consumeProseLiteral(message) {
    const anchor = this.consume("Prose", message);
    this.rejectInlineProse();
    return {
      token: anchor,
      content: anchor.content,
      lineNumber: anchor.lineNumber,
      position: anchor.position,
      indent: anchor.indent,
      sceneName: anchor.sceneName
    };
  }
  rejectInlineProse() {
    while (true) {
      const peek = this.peek();
      if (!peek) return;
      const t = peek.type;
      if (t === "OpenPrint" || t === "OpenPrintCapitaliseFirst" || t === "OpenPrintCapitaliseAll" || t === "OpenMultiReplace") {
        try {
          this.error(
            peek,
            "${...} / @{...} not allowed in literal context \u2014 runtime treats this as plain text."
          );
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        this.advance();
        let depth = 1;
        while (!this.isAtEnd() && depth > 0) {
          const next = this.advance();
          if (next.type === "OpenPrint" || next.type === "OpenPrintCapitaliseFirst" || next.type === "OpenPrintCapitaliseAll" || next.type === "OpenMultiReplace") {
            depth++;
          } else if (next.type === "CloseBrace") {
            depth--;
          }
        }
        continue;
      }
      return;
    }
  }
  matchProseValue() {
    if (!this.match(["Prose"], false, false)) return void 0;
    const anchor = this.previous();
    return this.proseValueFrom(anchor);
  }
  proseValueFrom(anchor, sameLine = false) {
    const parsedSegments = [];
    const content = [anchor];
    this.appendTextSegment(parsedSegments, anchor);
    this.collectProseSegments(parsedSegments, content, anchor.indent, [], sameLine ? anchor.lineNumber : null);
    const joined = content.map((t) => t.content).join("");
    return {
      token: anchor,
      content: joined,
      parsedSegments,
      lineNumber: anchor.lineNumber,
      position: anchor.position,
      indent: anchor.indent,
      sceneName: anchor.sceneName
    };
  }
  appendTextSegment(out, token) {
    if (!token.content || token.content.length === 0) return;
    out.push({
      kind: "Text",
      start: 0,
      end: token.content.length,
      lineNumber: token.lineNumber,
      position: token.position,
      text: token.content
    });
  }
  collectProseSegments(out, content, sameIndent, stopAt = [], sameLine = null) {
    while (!this.isAtEnd()) {
      const peek = this.peek();
      if (sameLine !== null && peek.lineNumber !== sameLine) return;
      if (stopAt.includes(peek.type)) return;
      if (peek.type === "Prose" && peek.indent === sameIndent) {
        this.advance();
        const prose = this.previous();
        content.push(prose);
        this.appendTextSegment(out, prose);
        continue;
      }
      if (peek.type === "OpenPrint" || peek.type === "OpenPrintCapitaliseFirst" || peek.type === "OpenPrintCapitaliseAll") {
        const opener = this.advance();
        let expr = void 0;
        try {
          expr = this.expression();
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        try {
          this.consume("CloseBrace", "Expect '}' after print expression.");
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        out.push({
          ...this.printKindFor(opener.type),
          start: 0,
          end: 0,
          lineNumber: opener.lineNumber,
          position: opener.position,
          expression: expr
        });
        continue;
      }
      if (peek.type === "OpenMultiReplace") {
        const opener = this.advance();
        let selector2 = void 0;
        try {
          selector2 = this.expression();
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        const alternatives = [];
        while (true) {
          const altSegments = [];
          this.collectProseSegments(altSegments, content, sameIndent, [
            "MultiReplaceElse",
            "CloseBrace"
          ]);
          alternatives.push({
            start: 0,
            end: 0,
            segments: altSegments
          });
          if (this.match(["MultiReplaceElse"], false, false)) continue;
          break;
        }
        try {
          this.consume("CloseBrace", "Expect '}' after multireplace.");
        } catch (e) {
          if (!(e instanceof ParseErrorSignal)) throw e;
        }
        if (this.previous().type === "CloseBrace" && this.previous().lineNumber !== opener.lineNumber) {
          const closeBrace = this.previous();
          this.errors.push({
            token: opener,
            endToken: closeBrace,
            message: `Multireplace spans multiple lines \u2014 @{...} must be on a single line.`,
            context: this.contextStack.map((c) => ({ ...c })),
            solutionCode: "multiline-multireplace"
          });
        }
        out.push({
          kind: "MultiReplace",
          start: 0,
          end: 0,
          lineNumber: opener.lineNumber,
          position: opener.position,
          selector: selector2,
          alternatives
        });
        continue;
      }
      return;
    }
  }
  printKindFor(type) {
    if (type === "OpenPrintCapitaliseFirst")
      return { kind: "PrintCapitaliseFirst" };
    if (type === "OpenPrintCapitaliseAll") return { kind: "PrintCapitaliseAll" };
    return { kind: "Print" };
  }
  expressionStatement() {
    const expr = this.expression();
    return this.assignStatementId({
      kind: "Expression",
      expression: expr
    });
  }
  createVariable(temporary) {
    const token = this.previous();
    const canUseCreate = !temporary && this.sceneName === "startup" && !this.seenNonHeaderStatement;
    if (!temporary && !canUseCreate) {
      this.error(token, "*create is only allowed at the top of startup, before any non-header statements");
    }
    const identifier = this.consume("Identifier", "Expect variable name");
    const expr = !this.peekSameLine() ? null : this.expression();
    this.expectLineChange();
    return this.assignStatementId({
      kind: "DeclareVariable",
      variable: identifier,
      expression: expr,
      scope: temporary ? "Temporary" : "Global",
      token
    });
  }
  createArray(temporary) {
    const token = this.previous();
    const canUseCreate = !temporary && this.sceneName === "startup" && !this.seenNonHeaderStatement;
    if (!temporary && !canUseCreate) {
      this.error(token, "*create_array is only allowed at the top of startup, before any non-header statements");
    }
    const identifier = this.consume("Identifier", "Expect array name");
    const countExpr = this.expression();
    if (countExpr.kind !== "Literal" || countExpr.value.type !== "NumberLiteral") {
      this.error(token, "Array count must be a numeric literal");
    }
    const count = countExpr.value.value;
    const valueExpr = !this.peekSameLine() ? null : this.expression();
    this.expectLineChange();
    const declarations = [];
    for (let i = 1; i <= count; i++) {
      const syntheticIdentifier = {
        ...identifier,
        value: `${identifier.value}_${i}`
      };
      declarations.push(this.assignStatementId({
        kind: "DeclareVariable",
        variable: syntheticIdentifier,
        expression: valueExpr,
        scope: temporary ? "Temporary" : "Global",
        token
      }));
    }
    return this.assignStatementId({
      kind: "DeclareArray",
      token,
      variable: identifier,
      count,
      declarations,
      scope: temporary ? "Temporary" : "Global"
    });
  }
  deleteVariable() {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect variable name");
    this.expectLineChange();
    return this.assignStatementId({
      kind: "DeleteVariable",
      token,
      variable: identifier
    });
  }
  deleteArray() {
    const token = this.previous();
    const identifier = this.consume("Identifier", "Expect array name");
    this.expectLineChange();
    return this.assignStatementId({
      kind: "DeleteArray",
      token,
      variable: identifier
    });
  }
  setVariable() {
    const token = this.previous();
    const identifierOrAssignment = this.expression();
    let assignment = void 0;
    if (this.peekSameLine()) {
      assignment = this.expression();
    }
    this.expectLineChange();
    return this.assignStatementId({
      kind: "SetVariable",
      expression: identifierOrAssignment,
      assignment,
      token
    });
  }
  synchronize() {
    if (this.isAtEnd()) return;
    const errorIndent = this.peek().indent;
    this.advance();
    while (!this.isAtEnd()) {
      const next = this.peek();
      if (next.indent > errorIndent) {
        this.advance();
        continue;
      }
      switch (next.type) {
        case "Prose":
        case "Choice":
        case "FakeChoice":
        case "If":
        case "GotoLabel":
        case "GotoScene":
        case "Label":
        case "PageBreak":
        case "LineBreak":
        case "SetVariable":
        case "CreateVariable":
        case "CreateTempVariable":
        case "Image":
        case "TextImage":
        case "GoSub":
        case "GoSubScene":
        case "Finish":
        case "Return":
        case "Comment":
        case "Ending":
        case "Author":
        case "SceneList":
        case "Achievement":
        case "Achieve":
        case "CheckAchievements":
        case "Link":
        case "GenerateRandom":
        case "InputText":
        case "InputNumber":
        case "Parameters":
        case "StatChart":
        case "GameIdentifier":
        case "SaveCheckpoint":
        case "RestoreCheckpoint":
        case "ChoiceOption":
        case "AllowReuse":
        case "DisableReuse":
        case "HideReuse":
        case "SelectableIf":
          return;
      }
      this.advance();
    }
  }
  parse() {
    const statements = [];
    while (!this.isAtEnd()) {
      statements.push(this.statement());
    }
    return statements;
  }
};

// ../analysis/control-flow-graph/build-scene/walk-statement-list.ts
var qualifyStmtId = (state, stmtId) => `${state.sceneName}:${stmtId}`;
var beginCodeBlock = (state, entryType) => {
  const id = `${state.sceneName}:b_${state.nextBlockNum++}`;
  const block = {
    id,
    scene: state.sceneName,
    statementIds: [],
    entryType,
    exitType: "FallThrough"
  };
  state.blocks[id] = block;
  return block;
};
var connect = (state, sourceBlockId, targetBlockId, kind, metadata = {}) => {
  const id = `${state.sceneName}:e_${state.nextEdgeNum++}`;
  const edge = { id, kind, sourceBlockId, targetBlockId, metadata };
  state.edges.push(edge);
  return edge;
};
var isLiteralLabelReference = (label) => {
  return label != null && "type" in label && label["type"] !== void 0;
};
var walkStatementList = (stmts, state, initialEntryType, isTopLevel) => {
  let currentBlock = beginCodeBlock(state, initialEntryType);
  const entryBlockId = currentBlock.id;
  const exitBlockIds = [];
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    switch (stmt.kind) {
      case "Label": {
        const labelStmt = stmt;
        const prevBlock = currentBlock;
        currentBlock = beginCodeBlock(state, "Label");
        connect(state, prevBlock.id, currentBlock.id, "FallThrough");
        currentBlock.label = labelStmt.label.value;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        state.labelToBlockId[labelStmt.label.value] = currentBlock.id;
        break;
      }
      case "GotoLabel": {
        const gotoStmt = stmt;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Goto";
        if (isLiteralLabelReference(gotoStmt.label)) {
          const label = gotoStmt.label.value;
          const edge = connect(state, currentBlock.id, null, "Goto", { label });
          state.pendingTransitions.push({ edgeId: edge.id, label });
        } else {
          connect(state, currentBlock.id, null, "Unresolved", { dynamicExpression: true });
        }
        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }
      case "GotoScene": {
        const gotoScene = stmt;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "GotoScene";
        const metadata = { targetScene: gotoScene.scene.value };
        if (gotoScene.label && isLiteralLabelReference(gotoScene.label)) {
          metadata.targetSceneLabel = gotoScene.label.value;
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
        connect(state, currentBlock.id, null, "Return");
        currentBlock = beginCodeBlock(state, "Continuation");
        break;
      }
      case "If": {
        const ifStmt = stmt;
        currentBlock.statementIds.push(qualifyStmtId(state, stmt.statementId));
        currentBlock.exitType = "Branch";
        const contBlock = beginCodeBlock(state, "Continuation");
        const ifResult = walkStatementList(ifStmt.body, state, "ConditionalBody", false);
        connect(state, currentBlock.id, ifResult.entryBlockId, "IfBranch", {
          conditionStatementId: qualifyStmtId(state, stmt.statementId)
        });
        for (const exitId of ifResult.exitBlockIds) {
          connect(state, exitId, contBlock.id, "FallThrough");
        }
        for (const branch of ifStmt.elseIfBranches) {
          const result = walkStatementList(branch.body, state, "ConditionalBody", false);
          const entryBlock = state.blocks[result.entryBlockId];
          if (entryBlock) entryBlock.statementIds.unshift(qualifyStmtId(state, branch.statementId));
          connect(state, currentBlock.id, result.entryBlockId, "ElseIfBranch", {
            conditionStatementId: qualifyStmtId(state, branch.statementId)
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
        const choiceStmt = stmt;
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
          const gosubStmt = stmt;
          currentBlock.exitType = "GoSub";
          if (isLiteralLabelReference(gosubStmt.label)) {
            const label = gosubStmt.label.value;
            const edge = connect(state, currentBlock.id, null, "GoSubCall", { label });
            state.pendingTransitions.push({ edgeId: edge.id, label });
          } else {
            connect(state, currentBlock.id, null, "Unresolved", { dynamicExpression: true });
          }
        } else {
          const gosubScene = stmt;
          currentBlock.exitType = "GoSubScene";
          const metadata = { targetScene: gosubScene.scene.value };
          if (isLiteralLabelReference(gosubScene.label)) {
            metadata.label = gosubScene.label.value;
          }
          connect(state, currentBlock.id, null, "GoSubSceneCall", metadata);
        }
        const contBlock = beginCodeBlock(state, "GoSubContinuation");
        connect(state, currentBlock.id, contBlock.id, "GoSubReturn");
        currentBlock = contBlock;
        break;
      }
      case "SetVariable": {
        const setStmt = stmt;
        if (setStmt.expression?.token?.value === "implicit_control_flow") {
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
        const paramsStmt = stmt;
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
        const arrayStmt = stmt;
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
    const isReachable = currentBlock.id === entryBlockId || state.edges.some((e) => e.targetBlockId === currentBlock.id);
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
var connectChoiceOptions = (body, choiceBlockId, contBlockId, isChoice, state, choiceCondition) => {
  for (const child of body) {
    if (child.kind === "ChoiceOption") {
      const option = child;
      const result = walkStatementList(option.body, state, "ChoiceOptionEntry", false);
      const entryBlock = state.blocks[result.entryBlockId];
      if (entryBlock) entryBlock.statementIds.unshift(qualifyStmtId(state, option.statementId));
      const hasCheck = choiceCondition || option.selectableIf;
      const kind = hasCheck ? "ChoiceOptionCheck" : "ChoiceOption";
      const metadata = {
        optionStatementId: qualifyStmtId(state, option.statementId)
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
        connect(
          state,
          exitId,
          contBlockId,
          "FallThrough",
          isChoice ? { implicitControlFlow: true } : {}
        );
      }
    } else if (child.kind === "If") {
      const ifStmt = child;
      const ifId = qualifyStmtId(state, ifStmt.statementId);
      const choiceBlock = state.blocks[choiceBlockId];
      if (choiceBlock) choiceBlock.statementIds.push(qualifyStmtId(state, ifStmt.statementId));
      connectChoiceOptions(
        ifStmt.body,
        choiceBlockId,
        contBlockId,
        isChoice,
        state,
        { id: ifId, kind: "if" }
      );
      for (const branch of ifStmt.elseIfBranches) {
        if (choiceBlock) choiceBlock.statementIds.push(qualifyStmtId(state, branch.statementId));
        connectChoiceOptions(
          branch.body,
          choiceBlockId,
          contBlockId,
          isChoice,
          state,
          { id: qualifyStmtId(state, branch.statementId), kind: "elseif" }
        );
      }
      if (ifStmt.elseBranch) {
        if (choiceBlock) choiceBlock.statementIds.push(qualifyStmtId(state, ifStmt.elseBranch.statementId));
        connectChoiceOptions(
          ifStmt.elseBranch.body,
          choiceBlockId,
          contBlockId,
          isChoice,
          state,
          { id: ifId, kind: "else" }
        );
      }
    }
  }
};

// ../analysis/control-flow-graph/build-scene/build-control-flow.ts
var buildControlFlow = (scene, blockWriter) => {
  const context = {
    sceneName: scene.name,
    blocks: {},
    edges: [],
    pendingTransitions: [],
    nextBlockNum: 0,
    nextEdgeNum: 0,
    labelToBlockId: {},
    currentReuseMode: null
  };
  const isTopLevel = true;
  const result = walkStatementList(scene.statements, context, "SceneEntry", isTopLevel);
  for (const deferred of context.pendingTransitions) {
    const edge = context.edges.find((e) => e.id === deferred.edgeId);
    const targetBlockId = context.labelToBlockId[deferred.label];
    if (targetBlockId) {
      edge.targetBlockId = targetBlockId;
    } else {
      edge.kind = "Unresolved";
    }
  }
  const externalTransitions = [
    "SceneExit",
    "GameEnd",
    "Return",
    "GotoScene",
    "GoSubSceneCall"
  ];
  const unresolvedEdges = context.edges.filter(
    (e) => e.kind === "Unresolved" || e.targetBlockId === null && !externalTransitions.includes(e.kind)
  );
  for (const block of Object.values(context.blocks)) {
    blockWriter.write(block);
  }
  blockWriter.flush();
  const blockRefs = {};
  for (const [id, block] of Object.entries(context.blocks)) {
    blockRefs[id] = { id, exitType: block.exitType };
  }
  return {
    sceneName: scene.name,
    blocks: blockRefs,
    blockIndex: context.blocks,
    edges: context.edges,
    entryBlockId: result.entryBlockId,
    labelToBlockId: context.labelToBlockId,
    unresolvedEdges
  };
};

// ../analysis/control-flow-graph/data/transition-kind.ts
var isChoiceOptionEdge = (kind) => kind === "ChoiceOption" || kind === "ChoiceOptionCheck";
var isGoSubCall = (kind) => kind === "GoSubCall" || kind === "GoSubSceneCall";
var isGoSubReturn = (kind) => kind === "GoSubReturn" || kind === "GoSubSceneReturn";
var isConditionalBranch = (kind) => kind === "IfBranch" || kind === "ElseIfBranch" || kind === "ElseBranch" || kind === "IfFallThrough";

// ../analysis/ref-cfg/passes/transfer-pass.ts
var TransferPass = class {
  allBlocks = /* @__PURE__ */ new Map();
  exits = [];
  onStatement(ctx, _stmtId, _stmt) {
    if (!this.allBlocks.has(ctx.blockId)) {
      this.allBlocks.set(ctx.blockId, ctx.guards);
    }
  }
  onExit(ctx) {
    this.exits.push({
      exitIndex: ctx.exitIndex,
      guards: ctx.guards,
      conditional: ctx.conditional
    });
  }
  finish(cfg) {
    const effects = [];
    for (const [blockId, guards] of this.allBlocks) {
      effects.push({ blockId, guards });
    }
    return { cfgId: cfg.id, effects, exits: this.exits };
  }
};

// ../analysis/ref-cfg/scope-types.ts
var lookupScope = (node, variable) => {
  let current = node;
  while (current) {
    if (current.deletes.has(variable)) return null;
    for (let i = current.defs.length - 1; i >= 0; i--) {
      if (current.defs[i].variable === variable) return current.defs[i];
    }
    current = current.parent;
  }
  return null;
};

// ../analysis/dataflow/extract-definitions.ts
var extractEffect = (stmt) => {
  switch (stmt.kind) {
    case "DeclareVariable":
      return extractDeclareVariable(stmt);
    case "SetVariable":
      return extractSetVariable(stmt);
    case "GenerateRandom":
      return extractGenerateRandom(stmt);
    case "InputText":
      return extractInputText(stmt);
    case "InputNumber":
      return extractInputNumber(stmt);
    default:
      return {};
  }
};
var extractDeclareVariable = (stmt) => {
  const name = stmt.variable?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: stmt.scope ?? "Global",
      valueExpression: stmt.expression ?? null,
      isCompoundAssignment: false
    }
  };
};
var extractSetVariable = (stmt) => {
  if (stmt.assignment) {
    const name = extractIdentifierName(stmt.expression);
    if (!name) return {};
    return {
      defines: {
        variable: name,
        scope: "Global",
        valueExpression: stmt.assignment,
        isCompoundAssignment: false
      }
    };
  } else {
    const name = extractIdentifierFromBinaryLeft(stmt.expression);
    if (!name) return {};
    return {
      defines: {
        variable: name,
        scope: "Global",
        valueExpression: null,
        isCompoundAssignment: true,
        compoundExpression: stmt.expression
      }
    };
  }
};
var extractGenerateRandom = (stmt) => {
  const name = stmt.identifier?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: "Global",
      valueExpression: null,
      isCompoundAssignment: false
    }
  };
};
var extractInputText = (stmt) => {
  const name = stmt.storeInto?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: "Global",
      valueExpression: null,
      isCompoundAssignment: false
    }
  };
};
var extractInputNumber = (stmt) => {
  const name = stmt.storeInto?.value;
  if (!name) return {};
  return {
    defines: {
      variable: name,
      scope: "Global",
      valueExpression: null,
      isCompoundAssignment: false
    }
  };
};
var isIdentifier = (expr) => expr && expr.token && expr.token.type === "Identifier";
var isBinary = (expr) => expr && expr.left && expr.operator && expr.right;
var extractIdentifierName = (expr) => {
  if (!expr) return null;
  if (isIdentifier(expr)) return expr.token.value ?? null;
  return null;
};
var extractIdentifierFromBinaryLeft = (expr) => {
  if (!expr || !isBinary(expr)) return null;
  return extractIdentifierName(expr.left);
};

// ../analysis/dataflow/abstract-value.ts
var MAX_SET_SIZE = 128;
var bottom = { kind: "bottom" };
var top = { kind: "top" };
var input = { kind: "input" };
var loop = { kind: "loop" };
var constant = (value) => ({
  kind: "constant",
  value
});
var range = (min, max) => ({
  kind: "range",
  min,
  max
});
var set = (values, hasUserInput) => {
  const unique = [...new Set(values)];
  if (unique.length === 0) return hasUserInput ? input : bottom;
  if (unique.length === 1 && !hasUserInput) return constant(unique[0]);
  if (unique.length > MAX_SET_SIZE) {
    if (unique.every((v) => typeof v === "number")) {
      const nums = unique;
      return range(Math.min(...nums), Math.max(...nums));
    }
    return top;
  }
  return hasUserInput ? { kind: "set", values: unique, hasUserInput: true } : { kind: "set", values: unique };
};
var join = (a, b) => {
  if (a.kind === "bottom") return b;
  if (b.kind === "bottom") return a;
  if (a.kind === "top" || b.kind === "top") return top;
  if (a.kind === "input" || b.kind === "input") {
    if (a.kind === "loop" || b.kind === "loop") return top;
    const other = a.kind === "input" ? b : a;
    if (other.kind === "input") return input;
    if (other.kind === "constant") return { kind: "set", values: [other.value], hasUserInput: true };
    if (other.kind === "set") return other.hasUserInput ? other : { ...other, hasUserInput: true };
    return input;
  }
  if (a.kind === "loop" || b.kind === "loop") return loop;
  if (a.kind === "constant" && b.kind === "constant") {
    return a.value === b.value ? a : set([a.value, b.value]);
  }
  if (a.kind === "range" && b.kind === "range") {
    return range(Math.min(a.min, b.min), Math.max(a.max, b.max));
  }
  if (a.kind === "set" && b.kind === "set") {
    const ui = a.hasUserInput || b.hasUserInput || void 0;
    return set([...a.values, ...b.values], ui);
  }
  if (a.kind === "constant" && b.kind === "set") {
    return set([a.value, ...b.values], b.hasUserInput);
  }
  if (a.kind === "set" && b.kind === "constant") {
    return set([...a.values, b.value], a.hasUserInput);
  }
  if (a.kind === "constant" && b.kind === "range") {
    if (typeof a.value === "number") {
      return range(Math.min(a.value, b.min), Math.max(a.value, b.max));
    }
    return top;
  }
  if (a.kind === "range" && b.kind === "constant") {
    return join(b, a);
  }
  if (a.kind === "set" && b.kind === "range") {
    if (a.values.every((v) => typeof v === "number")) {
      const nums = a.values;
      return range(
        Math.min(b.min, ...nums),
        Math.max(b.max, ...nums)
      );
    }
    return top;
  }
  if (a.kind === "range" && b.kind === "set") {
    return join(b, a);
  }
  return top;
};
var narrowToValue = (av, target) => {
  if (av.kind === "bottom") return bottom;
  return constant(target);
};

// ../analysis/dataflow/variable-state.ts
var emptyState = () => ({
  parent: null,
  globals: /* @__PURE__ */ new Map(),
  temps: /* @__PURE__ */ new Map()
});
var cloneState = (state) => ({
  parent: state,
  globals: /* @__PURE__ */ new Map(),
  temps: /* @__PURE__ */ new Map()
});
var getVariable = (state, name, scene) => {
  const lower = name.toLowerCase();
  let current = state;
  while (current) {
    const val = current.temps.get(scene)?.get(lower);
    if (val !== void 0) return val;
    current = current.parent;
  }
  current = state;
  while (current) {
    if (current.globals.has(lower)) return current.globals.get(lower);
    current = current.parent;
  }
  return bottom;
};
var isTempVariable = (state, name, scene) => {
  const lower = name.toLowerCase();
  let current = state;
  while (current) {
    if (current.temps.get(scene)?.has(lower)) return true;
    current = current.parent;
  }
  return false;
};
var hasGlobal = (state, name) => {
  const lower = name.toLowerCase();
  let current = state;
  while (current) {
    if (current.globals.has(lower)) return true;
    current = current.parent;
  }
  return false;
};
var setVariableMut = (state, name, value, scope, scene) => {
  const lower = name.toLowerCase();
  if (scope === "Global") {
    state.globals.set(lower, value);
  } else {
    if (!state.temps.has(scene)) state.temps.set(scene, /* @__PURE__ */ new Map());
    state.temps.get(scene).set(lower, value);
  }
};
var updateVariableMut = (state, name, value, scene) => {
  const lower = name.toLowerCase();
  if (isTempVariable(state, name, scene)) {
    if (!state.temps.has(scene)) state.temps.set(scene, /* @__PURE__ */ new Map());
    state.temps.get(scene).set(lower, value);
  } else {
    state.globals.set(lower, value);
  }
};
var materialize = (state) => {
  if (!state.parent) return state;
  const chain = [];
  let current = state;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  const result = { parent: null, globals: /* @__PURE__ */ new Map(), temps: /* @__PURE__ */ new Map() };
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [k, v] of chain[i].globals) result.globals.set(k, v);
    for (const [scene, vars] of chain[i].temps) {
      if (!result.temps.has(scene)) result.temps.set(scene, /* @__PURE__ */ new Map());
      const sceneMap = result.temps.get(scene);
      for (const [k, v] of vars) sceneMap.set(k, v);
    }
  }
  return result;
};
var joinStatesMut = (target, source) => {
  const sm = materialize(source);
  for (const [key, sVal] of sm.globals) {
    const tVal = getVariable(target, key, "");
    if (tVal === sVal) continue;
    if (tVal.kind === "bottom") {
      target.globals.set(key, sVal);
    } else if (tVal.kind !== "top") {
      target.globals.set(key, join(tVal, sVal));
    }
  }
  for (const [scene, sScene] of sm.temps) {
    if (!target.temps.has(scene)) target.temps.set(scene, /* @__PURE__ */ new Map());
    const tScene = target.temps.get(scene);
    for (const [key, sVal] of sScene) {
      const tVal = getVariable(target, key, scene);
      if (tVal === sVal) continue;
      if (tVal.kind === "bottom") {
        tScene.set(key, sVal);
      } else if (tVal.kind !== "top") {
        tScene.set(key, join(tVal, sVal));
      }
    }
  }
};
var serializeState = (state) => {
  const mat = materialize(state);
  const temps = {};
  for (const [scene, vars] of mat.temps) {
    temps[scene] = Object.fromEntries(vars);
  }
  return { globals: Object.fromEntries(mat.globals), temps };
};

// ../analysis/dataflow/evaluate-expression.ts
var classifyExpression = (expr) => {
  if (!expr) return "Unknown";
  if (expr.left && expr.operator && expr.right) return "Binary";
  if (expr.value && typeof expr.value === "object" && !expr.operator) {
    const vtype = expr.value.type;
    if (vtype === "StringLiteral" || vtype === "NumberLiteral" || vtype === "BooleanLiteral") {
      return "Literal";
    }
  }
  if (expr.operator && expr.value && !expr.left) return "Unary";
  if (expr.token && expr.token.type === "Identifier") return "Identifier";
  if (expr.identifier && expr.expression) return "ArrayIndexer";
  if (expr.expression && !expr.identifier) return "Grouping";
  return "Unknown";
};
var evaluateExpression = (expr, state, scene) => {
  if (!expr) return top;
  const type = classifyExpression(expr);
  switch (type) {
    case "Literal":
      return evaluateLiteral(expr);
    case "Identifier":
      return evaluateIdentifier(expr, state, scene);
    case "Binary":
      return evaluateBinary(expr, state, scene);
    case "Unary":
      return evaluateUnary(expr, state, scene);
    case "Grouping":
      return evaluateExpression(expr.expression, state, scene);
    case "ArrayIndexer":
      return evaluateArrayIndexer(expr, state, scene);
    case "Dereference":
      return top;
    default:
      return top;
  }
};
var evaluateLiteral = (expr) => {
  const token = expr.value;
  if (!token) return top;
  if (token.type === "StringLiteral") return constant(token.value);
  if (token.type === "NumberLiteral") return constant(token.value);
  if (token.type === "BooleanLiteral") return constant(token.value);
  return top;
};
var evaluateIdentifier = (expr, state, scene) => {
  const name = expr.token?.value;
  if (!name) return top;
  if (name === "choice_randomtest" || name === "choice_quicktest" || name === "choice_randomscene") {
    return top;
  }
  return getVariable(state, name, scene);
};
var evaluateBinary = (expr, state, scene) => {
  const opType = expr.operator?.type;
  if (!opType) return top;
  if (opType === "LogicalAnd" || opType === "LogicalOr") {
    const left2 = evaluateExpression(expr.left, state, scene);
    const right2 = evaluateExpression(expr.right, state, scene);
    return evaluateLogical(left2, right2, opType);
  }
  const sharedVar = findSharedIdentifier(expr.left, expr.right);
  if (sharedVar) {
    const varValue = getVariable(state, sharedVar, scene);
    const vals = enumerateValues(varValue);
    if (vals && vals.length <= MAX_SET_SIZE) {
      return evaluateCorrelated(expr, state, scene, sharedVar, vals, opType);
    }
  }
  const left = evaluateExpression(expr.left, state, scene);
  const right = evaluateExpression(expr.right, state, scene);
  if (isComparisonOperator(opType)) {
    return evaluateComparison(left, right, opType);
  }
  return evaluateArithmetic(left, right, opType);
};
var collectIdentifiers = (expr, out) => {
  if (!expr) return;
  const type = classifyExpression(expr);
  switch (type) {
    case "Identifier":
      if (expr.token?.value) out.add(expr.token.value.toLowerCase());
      break;
    case "Binary":
      collectIdentifiers(expr.left, out);
      collectIdentifiers(expr.right, out);
      break;
    case "Unary":
    case "Grouping":
      collectIdentifiers(expr.value ?? expr.expression, out);
      break;
  }
};
var findSharedIdentifier = (left, right) => {
  const leftIds = /* @__PURE__ */ new Set();
  const rightIds = /* @__PURE__ */ new Set();
  collectIdentifiers(left, leftIds);
  collectIdentifiers(right, rightIds);
  for (const id of leftIds) {
    if (rightIds.has(id)) return id;
  }
  return null;
};
var evaluateCorrelated = (expr, baseState, scene, varName, values, opType) => {
  const results = [];
  let hasNonEnumerable = false;
  for (const val of values) {
    const pinned = pinVariable(baseState, varName, val, scene);
    const left = evaluateExpression(expr.left, pinned, scene);
    const right = evaluateExpression(expr.right, pinned, scene);
    let result;
    if (isComparisonOperator(opType)) {
      result = evaluateComparison(left, right, opType);
    } else {
      result = evaluateArithmetic(left, right, opType);
    }
    if (result.kind === "constant") {
      results.push(result.value);
    } else if (result.kind === "set") {
      results.push(...result.values);
    } else {
      hasNonEnumerable = true;
    }
  }
  if (results.length === 0) return top;
  if (hasNonEnumerable) {
    const partial = set(results);
    return partial.kind === "top" ? top : join(partial, top);
  }
  return set(results);
};
var pinVariable = (state, name, value, scene) => {
  const pinned = cloneState(state);
  const pinnedVal = { kind: "constant", value };
  if (isTempVariable(state, name, scene)) {
    pinned.temps.set(scene, /* @__PURE__ */ new Map([[name, pinnedVal]]));
  } else {
    pinned.globals.set(name, pinnedVal);
  }
  return pinned;
};
var evaluateUnary = (expr, state, scene) => {
  const opType = expr.operator?.type;
  const operand = evaluateExpression(expr.value, state, scene);
  if (!opType) return top;
  switch (opType) {
    case "NotOperator":
      if (operand.kind === "constant") return constant(!isTruthy(operand.value));
      if (operand.kind === "set") {
        return set(
          operand.values.map((v) => !isTruthy(v)),
          operand.hasUserInput
        );
      }
      return top;
    case "RoundOperator":
      if (operand.kind === "constant" && typeof operand.value === "number")
        return constant(Math.round(operand.value));
      if (operand.kind === "range")
        return range(Math.round(operand.min), Math.round(operand.max));
      if (operand.kind === "set" && operand.values.every((v) => typeof v === "number")) {
        return set(
          operand.values.map((v) => Math.round(v)),
          operand.hasUserInput
        );
      }
      return top;
    case "LengthOperator":
      if (operand.kind === "constant" && typeof operand.value === "string")
        return constant(operand.value.length);
      if (operand.kind === "set") {
        const lengths = operand.values.filter((v) => typeof v === "string").map((v) => v.length);
        if (lengths.length === operand.values.length) return set(lengths, operand.hasUserInput);
      }
      return top;
    default:
      return top;
  }
};
var evaluateArrayIndexer = (expr, state, scene) => {
  const name = expr.identifier?.value;
  if (!name) return top;
  const base = getVariable(state, name, scene);
  const index = evaluateExpression(expr.expression, state, scene);
  const baseVals = toStringValues(base);
  const indexNums = toNumericValues(index);
  if (baseVals && indexNums) {
    const hasInput = baseVals.includes(INPUT_SENTINEL);
    const results = [];
    for (const b of baseVals) {
      if (b === INPUT_SENTINEL) continue;
      for (const i of indexNums) {
        const idx = i - 1;
        if (typeof b === "string" && idx >= 0 && idx < b.length) {
          results.push(b[idx]);
        }
      }
    }
    return results.length > 0 ? set(results, hasInput || void 0) : hasInput ? input : top;
  }
  return top;
};
var isComparisonOperator = (opType) => opType === "EqualityOperator" || opType === "NotEqualityOperator" || opType === "GreaterThanOperator" || opType === "LessThanOperator" || opType === "GreaterThanEqualsOperator" || opType === "LessThanEqualsOperator";
var evaluateComparison = (left, right, opType) => {
  if (left.kind === "constant" && right.kind === "constant") {
    const l = left.value;
    const r = right.value;
    switch (opType) {
      case "EqualityOperator":
        return constant(l === r);
      case "NotEqualityOperator":
        return constant(l !== r);
      case "GreaterThanOperator":
        return constant(l > r);
      case "LessThanOperator":
        return constant(l < r);
      case "GreaterThanEqualsOperator":
        return constant(l >= r);
      case "LessThanEqualsOperator":
        return constant(l <= r);
      default:
        return top;
    }
  }
  const leftVals = enumerateValues(left);
  const rightVals = enumerateValues(right);
  if (leftVals && rightVals) {
    const results = /* @__PURE__ */ new Set();
    for (const l of leftVals) {
      for (const r of rightVals) {
        results.add(applyComparison(l, r, opType));
      }
      if (results.size === 2) break;
    }
    if (results.size === 1) return constant([...results][0]);
    if (results.size === 2) return set([true, false]);
    return top;
  }
  const leftRange = toRange(left);
  const rightRange = toRange(right);
  if (leftRange && rightRange && isFiniteRange(leftRange) && isFiniteRange(rightRange)) {
    return evaluateRangeComparison(leftRange, rightRange, opType);
  }
  return top;
};
var isFiniteRange = (r) => isFinite(r.min) && isFinite(r.max);
var evaluateRangeComparison = (l, r, opType) => {
  switch (opType) {
    case "GreaterThanOperator":
      if (l.min > r.max) return constant(true);
      if (l.max <= r.min) return constant(false);
      return set([true, false]);
    case "LessThanOperator":
      if (l.max < r.min) return constant(true);
      if (l.min >= r.max) return constant(false);
      return set([true, false]);
    case "GreaterThanEqualsOperator":
      if (l.min >= r.max) return constant(true);
      if (l.max < r.min) return constant(false);
      return set([true, false]);
    case "LessThanEqualsOperator":
      if (l.max <= r.min) return constant(true);
      if (l.min > r.max) return constant(false);
      return set([true, false]);
    case "EqualityOperator":
      if (l.min === l.max && r.min === r.max && l.min === r.min) return constant(true);
      if (l.max < r.min || l.min > r.max) return constant(false);
      return set([true, false]);
    case "NotEqualityOperator":
      if (l.max < r.min || l.min > r.max) return constant(true);
      if (l.min === l.max && r.min === r.max && l.min === r.min) return constant(false);
      return set([true, false]);
    default:
      return top;
  }
};
var applyComparison = (l, r, opType) => {
  switch (opType) {
    case "EqualityOperator":
      return l === r;
    case "NotEqualityOperator":
      return l !== r;
    case "GreaterThanOperator":
      return l > r;
    case "LessThanOperator":
      return l < r;
    case "GreaterThanEqualsOperator":
      return l >= r;
    case "LessThanEqualsOperator":
      return l <= r;
    default:
      return false;
  }
};
var enumerateValues = (av) => {
  if (av.kind === "constant") return [av.value];
  if (av.kind === "set" && !av.hasUserInput) return av.values;
  return null;
};
var evaluateLogical = (left, right, opType) => {
  const lt = abstractTruthiness(left);
  const rt = abstractTruthiness(right);
  if (opType === "LogicalAnd") {
    if (lt === false || rt === false) return constant(false);
    if (lt === true && rt === true) return constant(true);
    if (lt === null || rt === null) return set([true, false]);
    return constant(lt && rt);
  }
  if (opType === "LogicalOr") {
    if (lt === true || rt === true) return constant(true);
    if (lt === false && rt === false) return constant(false);
    if (lt === null || rt === null) return set([true, false]);
    return constant(lt || rt);
  }
  return top;
};
var abstractTruthiness = (av) => {
  if (av.kind === "constant") return isTruthy(av.value);
  if (av.kind === "set") {
    const truths = av.values.map(isTruthy);
    const allTrue = truths.every((t) => t);
    const allFalse = truths.every((t) => !t);
    if (av.hasUserInput) return allTrue ? null : allFalse ? null : null;
    if (allTrue) return true;
    if (allFalse) return false;
    return null;
  }
  if (av.kind === "range") {
    if (av.min > 0 || av.max < 0) return true;
    if (av.min === 0 && av.max === 0) return false;
    return null;
  }
  return null;
};
var isTruthy = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "";
  return true;
};
var evaluateArithmetic = (left, right, opType) => {
  if (left.kind === "bottom" || right.kind === "bottom") return bottom;
  if (opType === "FairmathAdditionOperator" || opType === "FairmathSubtractionOperator") {
    const isAdd = opType === "FairmathAdditionOperator";
    const baseNums = toNumericValues(left);
    const modNums = toNumericValues(right);
    if (baseNums && modNums) {
      const results = baseNums.flatMap(
        (b) => modNums.map((m) => fairmath(b, m, isAdd))
      );
      const lo = Math.min(...results);
      const hi = Math.max(...results);
      return lo === hi ? constant(lo) : range(lo, hi);
    }
    const baseRange = toRange(left);
    const modRange = toRange(right);
    if (baseRange && modRange) {
      return computeFairmathRange(baseRange, modRange, isAdd);
    }
    return range(0, 100);
  }
  if (left.kind === "constant" && right.kind === "constant") {
    return computeConstant(left.value, right.value, opType);
  }
  if (opType === "ConcatenationOperator" && (left.kind === "range" || right.kind === "range")) {
    const formatRange = (r) => r.min === r.max ? String(r.min) : `${r.min}-${r.max}`;
    const leftStr = left.kind === "range" ? formatRange(left) : left.kind === "constant" ? String(left.value) : null;
    const rightStr = right.kind === "range" ? formatRange(right) : right.kind === "constant" ? String(right.value) : null;
    if (leftStr !== null && rightStr !== null) return constant(leftStr + rightStr);
  }
  if (opType === "ConcatenationOperator" || opType === "Indexer" || opType === "StringIndexerOperator") {
    const leftVals = toStringValues(left);
    const rightVals = toStringValues(right);
    if (leftVals && rightVals) {
      const hasInput = leftVals.includes(INPUT_SENTINEL) || rightVals.includes(INPUT_SENTINEL);
      if (opType === "ConcatenationOperator") {
        const concreteLeft = leftVals.filter((v) => v !== INPUT_SENTINEL);
        const concreteRight = rightVals.filter((v) => v !== INPUT_SENTINEL);
        const results = concreteLeft.flatMap(
          (l) => concreteRight.map((r) => String(l) + String(r))
        );
        return set(results, hasInput || void 0);
      } else {
        const results = [];
        for (const l of leftVals) {
          if (l === INPUT_SENTINEL) continue;
          for (const r of rightVals) {
            if (r === INPUT_SENTINEL) continue;
            if (typeof l === "string" && typeof r === "number") {
              const idx = r - 1;
              if (idx >= 0 && idx < l.length) results.push(l[idx]);
            }
          }
        }
        return results.length > 0 ? set(results, hasInput || void 0) : hasInput ? input : top;
      }
    }
  }
  if (isNumericArithmeticOp(opType)) {
    const leftNums = toNumericValues(left);
    const rightNums = toNumericValues(right);
    if (leftNums && rightNums && leftNums.length * rightNums.length <= MAX_SET_SIZE) {
      const results = [];
      for (const l of leftNums) {
        for (const r of rightNums) {
          const v = applyNumericOp(l, r, opType);
          if (v !== null) results.push(v);
        }
      }
      if (results.length > 0) return set(results);
    }
    const leftRange = toRange(left);
    const rightRange = toRange(right);
    if (leftRange && rightRange) {
      return computeRange(leftRange, rightRange, opType);
    }
  }
  return top;
};
var isNumericArithmeticOp = (opType) => opType === "AdditionOperator" || opType === "SubtractionOperator" || opType === "MultiplicationOperator" || opType === "DivisionOperator" || opType === "ModulusOperator";
var applyNumericOp = (l, r, opType) => {
  switch (opType) {
    case "AdditionOperator":
      return l + r;
    case "SubtractionOperator":
      return l - r;
    case "MultiplicationOperator":
      return l * r;
    case "DivisionOperator":
      return r === 0 ? null : Math.floor(l / r);
    case "ModulusOperator":
      return r === 0 ? null : l % r;
    default:
      return null;
  }
};
var INPUT_SENTINEL = "__USER_INPUT__";
var toStringValues = (av) => {
  if (av.kind === "constant") return [av.value];
  if (av.kind === "set") return av.hasUserInput ? [...av.values, INPUT_SENTINEL] : av.values;
  if (av.kind === "input") return [INPUT_SENTINEL];
  return null;
};
var toNumericValues = (av) => {
  if (av.kind === "constant" && typeof av.value === "number") {
    return [av.value];
  }
  if (av.kind === "set" && av.values.every((v) => typeof v === "number")) {
    return av.values;
  }
  return null;
};
var toRange = (av) => {
  if (av.kind === "constant" && typeof av.value === "number") {
    return { min: av.value, max: av.value };
  }
  if (av.kind === "set" && av.values.every((v) => typeof v === "number")) {
    const nums = av.values;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }
  if (av.kind === "range") return { min: av.min, max: av.max };
  if (av.kind === "top" || av.kind === "input" || av.kind === "loop") return { min: -Infinity, max: Infinity };
  return null;
};
var computeConstant = (l, r, opType) => {
  if (opType === "ConcatenationOperator") {
    return constant(String(l) + String(r));
  }
  if (opType === "StringIndexerOperator") {
    if (typeof l === "string" && typeof r === "number") {
      const idx = r - 1;
      if (idx >= 0 && idx < l.length) return constant(l[idx]);
    }
    return top;
  }
  if (typeof l !== "number" || typeof r !== "number") return top;
  switch (opType) {
    case "AdditionOperator":
      return constant(l + r);
    case "SubtractionOperator":
      return constant(l - r);
    case "MultiplicationOperator":
      return constant(l * r);
    case "DivisionOperator":
      return r === 0 ? top : constant(Math.floor(l / r));
    case "ModulusOperator":
      return r === 0 ? top : constant(l % r);
    default:
      return top;
  }
};
var computeRange = (l, r, opType) => {
  switch (opType) {
    case "AdditionOperator":
      return range(l.min + r.min, l.max + r.max);
    case "SubtractionOperator":
      return range(l.min - r.max, l.max - r.min);
    case "MultiplicationOperator": {
      const products = [l.min * r.min, l.min * r.max, l.max * r.min, l.max * r.max];
      return range(Math.min(...products), Math.max(...products));
    }
    case "DivisionOperator":
      if (r.min <= 0 && r.max >= 0) return top;
      const divs = [l.min / r.min, l.min / r.max, l.max / r.min, l.max / r.max];
      return range(Math.floor(Math.min(...divs)), Math.floor(Math.max(...divs)));
    case "ModulusOperator":
      if (r.min <= 0 && r.max >= 0) return top;
      return range(0, Math.max(Math.abs(r.min), Math.abs(r.max)) - 1);
    default:
      return top;
  }
};
var computeFairmathRange = (base, mod, isAdd) => {
  const bMin = Math.max(0, base.min);
  const bMax = Math.min(100, base.max);
  const mMin = Math.max(0, mod.min);
  const mMax = Math.min(100, mod.max);
  const corners = [
    fairmath(bMin, mMin, isAdd),
    fairmath(bMin, mMax, isAdd),
    fairmath(bMax, mMin, isAdd),
    fairmath(bMax, mMax, isAdd)
  ];
  const lo = Math.max(0, Math.min(...corners));
  const hi = Math.min(100, Math.max(...corners));
  if (lo === hi) return constant(lo);
  return range(lo, hi);
};
var fairmath = (base, modifier, isAdd) => {
  if (isAdd) {
    return Math.round(base + (100 - base) * modifier / 100);
  } else {
    return Math.round(base - base * modifier / 100);
  }
};
var extractVariableReads = (expr) => {
  if (!expr) return [];
  const reads = [];
  collectReads(expr, reads);
  return reads;
};
var collectReads = (expr, reads) => {
  if (!expr) return;
  const type = classifyExpression(expr);
  switch (type) {
    case "Identifier":
      if (expr.token?.value) reads.push(expr.token.value);
      break;
    case "Binary":
      collectReads(expr.left, reads);
      collectReads(expr.right, reads);
      break;
    case "Unary":
      collectReads(expr.value, reads);
      break;
    case "Grouping":
      collectReads(expr.expression, reads);
      break;
    case "ArrayIndexer":
      if (expr.identifier?.value) reads.push(expr.identifier.value);
      collectReads(expr.expression, reads);
      break;
  }
};

// ../analysis/ref-cfg/collect-refs.ts
var collectRefsFromStatement = (stmt) => {
  const exprs = extractExpressions(stmt);
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const expr of exprs) {
    for (const v of extractVariableReads(expr)) {
      if (!seen.has(v)) {
        seen.add(v);
        result.push(v);
      }
    }
  }
  return result;
};
var walkSegments = (segments, push) => {
  for (const seg of segments) {
    push(seg.expression);
    push(seg.selector);
    if (seg.alternatives) {
      for (const alt of seg.alternatives) {
        if (alt.segments) walkSegments(alt.segments, push);
      }
    }
  }
};
var extractExpressions = (stmt) => {
  const s = stmt;
  const exprs = [];
  const push = (e) => {
    if (e) exprs.push(e);
  };
  switch (stmt.kind) {
    case "SetVariable":
      push(s.expression);
      push(s.assignment);
      break;
    case "DeclareVariable":
      push(s.expression);
      break;
    case "If":
    case "ElseIf":
    case "SelectableIf":
    case "Expression":
      push(s.expression);
      break;
    case "ChoiceOption":
      push(s.selectableIf);
      if (s.parsedSegments) walkSegments(s.parsedSegments, push);
      break;
    case "GenerateRandom":
      push(s.min);
      push(s.max);
      break;
    case "InputNumber":
      push(s.min);
      push(s.max);
      break;
    case "Round":
    case "Length":
      push(s.expression);
      break;
    case "GoSub":
    case "GoSubScene":
      if (s.label && typeof s.label === "object" && !s.label.type) push(s.label);
      if (s.args) for (const a of s.args) push(a);
      break;
    case "GotoLabel":
    case "GotoScene":
      if (s.label && typeof s.label === "object" && !s.label.type) push(s.label);
      break;
    case "Prose":
      if (s.parsedSegments) walkSegments(s.parsedSegments, push);
      break;
    default:
      if (s.expression) push(s.expression);
      if (s.selector) push(s.selector);
      break;
  }
  return exprs;
};

// ../analysis/ref-cfg/passes/scope-pass.ts
var ScopePass = class {
  defs = [];
  refs = [];
  deletes = [];
  exitNodes = [];
  onStatement(ctx, stmtId, stmt) {
    if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
      const name = stmt.variable?.value;
      if (name) {
        ctx.scopeNode.deletes.add(name);
        this.deletes.push({ variable: name, statementId: stmtId, blockId: ctx.blockId });
      }
      return;
    }
    const stmtRefs = collectRefsFromStatement(stmt);
    for (const v of stmtRefs) {
      const found = lookupScope(ctx.scopeNode, v);
      this.refs.push({
        variable: v,
        statementId: stmtId,
        statementKind: stmt.kind,
        blockId: ctx.blockId,
        external: !found
      });
    }
    const effect = extractEffect(stmt);
    if (effect.defines) {
      const entry = {
        variable: effect.defines.variable,
        scope: effect.defines.scope,
        statementId: stmtId
      };
      ctx.scopeNode.defs.push(entry);
      const presence = ctx.guarded ? "may" : "must";
      this.defs.push({
        variable: entry.variable,
        scope: entry.scope,
        presence,
        statementId: stmtId,
        blockId: ctx.blockId
      });
    }
    if (stmt.kind === "DeclareArray") {
      const arr = stmt;
      if (arr.declarations) {
        for (const decl of arr.declarations) {
          const sub = extractEffect(decl);
          if (sub.defines) {
            const entry = {
              variable: sub.defines.variable,
              scope: sub.defines.scope,
              statementId: stmtId
            };
            ctx.scopeNode.defs.push(entry);
            const presence = ctx.guarded ? "may" : "must";
            this.defs.push({
              variable: entry.variable,
              scope: entry.scope,
              presence,
              statementId: stmtId,
              blockId: ctx.blockId
            });
          }
        }
      }
    }
    if (stmt.kind === "Parameters") {
      const params = stmt;
      for (const id of params.identifiers) {
        const entry = {
          variable: id.value,
          scope: "Temporary",
          statementId: stmtId
        };
        ctx.scopeNode.defs.push(entry);
        const presence = ctx.guarded ? "may" : "must";
        this.defs.push({
          variable: entry.variable,
          scope: entry.scope,
          presence,
          statementId: stmtId,
          blockId: ctx.blockId
        });
      }
    }
  }
  onExit(ctx) {
    if (ctx.scopeNode) this.exitNodes.push(ctx.scopeNode);
  }
  finish(cfg) {
    const exports2 = /* @__PURE__ */ new Map();
    for (const def of this.defs) {
      const existing = exports2.get(def.variable);
      if (!existing || def.presence === "must" && existing.presence === "may") {
        exports2.set(def.variable, {
          variable: def.variable,
          scope: def.scope,
          presence: def.presence
        });
      }
    }
    for (const del of this.deletes) {
      exports2.delete(del.variable);
    }
    const externalRefs = [];
    const seenExternal = /* @__PURE__ */ new Set();
    for (const ref of this.refs) {
      if (ref.external && !seenExternal.has(ref.variable)) {
        seenExternal.add(ref.variable);
        externalRefs.push(ref.variable);
      }
    }
    return {
      cfgId: cfg.id,
      scene: cfg.scene,
      tree: /* @__PURE__ */ new Map(),
      entryNode: null,
      exitNodes: this.exitNodes,
      defs: this.defs,
      refs: this.refs,
      deletes: this.deletes,
      exports: exports2,
      externalRefs
    };
  }
};

// ../analysis/ref-cfg/passes/symbol-table-pass.ts
var SymbolTablePass = class {
  declarations = [];
  sets = [];
  refs = [];
  labelRefs = [];
  onStatement(_ctx, stmtId, stmt) {
    if (stmt.kind === "DeclareVariable") {
      const decl = stmt;
      this.declarations.push({ name: decl.variable.value, scope: decl.scope });
    } else if (stmt.kind === "DeclareArray") {
      const arr = stmt;
      this.declarations.push({ name: arr.variable.value, scope: arr.scope });
      for (const sub of arr.declarations) {
        this.declarations.push({ name: sub.variable.value, scope: sub.scope });
      }
    } else if (stmt.kind === "Parameters") {
      const params = stmt;
      for (const id of params.identifiers) {
        this.declarations.push({ name: id.value, scope: "Temporary", isParam: true });
      }
    }
    const effect = extractEffect(stmt);
    if (effect.defines && stmt.kind !== "DeclareVariable") {
      this.sets.push(effect.defines.variable);
    }
    const refs = collectRefsFromStatement(stmt);
    const defVar = effect.defines?.variable;
    for (const ref of refs) {
      if (ref !== defVar) this.refs.push(ref);
    }
    this.collectLabelRef(stmt, stmtId);
  }
  collectLabelRef(stmt, stmtId) {
    switch (stmt.kind) {
      case "GotoLabel": {
        const gt = stmt;
        const literal = isLiteralLabel(gt.label);
        this.labelRefs.push({
          kind: "goto",
          label: literal ? gt.label.value : void 0,
          stmtId,
          dynamic: !literal
        });
        break;
      }
      case "GotoScene": {
        const gs = stmt;
        const sceneLit = isLiteralLabel(gs.scene);
        const labelLit = gs.label ? isLiteralLabel(gs.label) : false;
        this.labelRefs.push({
          kind: "goto_scene",
          scene: sceneLit ? gs.scene.value : void 0,
          label: labelLit ? gs.label.value : void 0,
          stmtId,
          dynamic: !sceneLit
        });
        break;
      }
      case "GoSub": {
        const gsub = stmt;
        const literal = isLiteralLabel(gsub.label);
        this.labelRefs.push({
          kind: "gosub",
          label: literal ? gsub.label.value : void 0,
          stmtId,
          dynamic: !literal
        });
        break;
      }
      case "GoSubScene": {
        const gss = stmt;
        const sceneLit = isLiteralLabel(gss.scene);
        const labelLit = gss.label ? isLiteralLabel(gss.label) : false;
        this.labelRefs.push({
          kind: "gosub_scene",
          scene: sceneLit ? gss.scene.value : void 0,
          label: labelLit ? gss.label.value : void 0,
          stmtId,
          dynamic: !sceneLit
        });
        break;
      }
    }
  }
  finish(cfg) {
    return {
      cfgId: cfg.id,
      scene: cfg.scene,
      declarations: this.declarations,
      sets: this.sets,
      refs: this.refs,
      labelRefs: this.labelRefs
    };
  }
};
var isLiteralLabel = (ref) => ref != null && "type" in ref && ref["type"] !== void 0;

// ../analysis/ref-cfg/passes/casing-pass.ts
var collectIdentifierTokens = (expr) => {
  const tokens = [];
  const walk = (e) => {
    if (!e) return;
    if (e.kind === "Identifier" && e.token) {
      tokens.push(e.token);
      return;
    }
    if (e.left) walk(e.left);
    if (e.right) walk(e.right);
    if (e.value && typeof e.value === "object" && e.operator) walk(e.value);
    if (e.expression) walk(e.expression);
    if (e.identifier && e.kind === "ArrayIndexer") {
      tokens.push(e.identifier);
      walk(e.expression);
      return;
    }
  };
  walk(expr);
  return tokens;
};
var isMiscased = (token) => !!token.rawValue && token.rawValue !== token.value;
var CasingPass = class {
  issues = [];
  onStatement(_ctx, stmtId, stmt) {
    this.checkDefinitions(stmtId, stmt);
    this.checkReferences(stmtId, stmt);
  }
  finish(_cfg) {
    return this.issues;
  }
  addIssue(stmtId, token, kind, category) {
    if (isMiscased(token)) {
      this.issues.push({ stmtId, token, kind, category });
    }
  }
  checkDefinitions(stmtId, stmt) {
    if (stmt.kind === "Label") {
      this.addIssue(stmtId, stmt.label, "definition", "label");
    } else if (stmt.kind === "DeclareVariable") {
      this.addIssue(stmtId, stmt.variable, "definition", "variable");
    } else if (stmt.kind === "DeclareArray") {
      const arr = stmt;
      this.addIssue(stmtId, arr.variable, "definition", "variable");
      for (const sub of arr.declarations) {
        this.addIssue(stmtId, sub.variable, "definition", "variable");
      }
    } else if (stmt.kind === "Parameters") {
      for (const id of stmt.identifiers) {
        this.addIssue(stmtId, id, "definition", "variable");
      }
    }
  }
  checkReferences(stmtId, stmt) {
    for (const expr of extractExpressions(stmt)) {
      for (const token of collectIdentifierTokens(expr)) {
        this.addIssue(stmtId, token, "reference", token.isLabelName ? "label" : "variable");
      }
    }
    this.checkDirectTokens(stmtId, stmt);
  }
  checkDirectTokens(stmtId, stmt) {
    const s = stmt;
    switch (stmt.kind) {
      case "InputNumber": {
        const inp = stmt;
        this.addIssue(stmtId, inp.storeInto, "reference", "variable");
        break;
      }
      case "InputText":
        this.addIssue(stmtId, stmt.storeInto, "reference", "variable");
        break;
      case "GenerateRandom":
        this.addIssue(stmtId, stmt.identifier, "reference", "variable");
        break;
      case "GotoLabel":
        this.checkLabelToken(stmtId, stmt.label);
        break;
      case "GotoScene":
        this.checkLabelToken(stmtId, stmt.label);
        break;
      case "GoSub":
        this.checkLabelToken(stmtId, stmt.label);
        break;
      case "GoSubScene":
        this.checkLabelToken(stmtId, stmt.label);
        break;
      case "StatChart": {
        const chart = stmt;
        for (const stat of chart.stats) {
          this.addIssue(stmtId, stat.variable, "reference", "variable");
        }
        break;
      }
    }
  }
  checkLabelToken(stmtId, ref) {
    if (ref && "type" in ref && ref.type === "Identifier") {
      this.addIssue(stmtId, ref, "reference", "label");
    }
  }
};

// ../analysis/control-flow-graph/graph-utils.ts
var getOrSet = (map, key, create) => {
  let v = map.get(key);
  if (!v) {
    v = create();
    map.set(key, v);
  }
  return v;
};
var buildEdgesBySource = (edges) => {
  const map = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    getOrSet(map, edge.sourceBlockId, () => []).push(edge);
  }
  return map;
};
var topologicalBlockOrder = (blocks, edges) => {
  const inDegree = /* @__PURE__ */ new Map();
  const succs = /* @__PURE__ */ new Map();
  for (const id of Object.keys(blocks)) {
    inDegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!edge.targetBlockId || !blocks[edge.targetBlockId]) continue;
    const list = succs.get(edge.sourceBlockId);
    if (list) list.push(edge.targetBlockId);
    else succs.set(edge.sourceBlockId, [edge.targetBlockId]);
    inDegree.set(edge.targetBlockId, (inDegree.get(edge.targetBlockId) ?? 0) + 1);
  }
  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  const order = [];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    order.push(id);
    for (const succ of succs.get(id) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }
  return order;
};

// ../analysis/ref-cfg/cfg-cache.ts
var fnv1a = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};
var hashCfg = (cfg, blockIndex, statements) => {
  const parts = [];
  const blockIds = Object.keys(cfg.blocks).sort();
  for (const blockId of blockIds) {
    const block = blockIndex[blockId];
    if (!block) continue;
    parts.push(blockId);
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (stmt) parts.push(JSON.stringify(stmt));
    }
  }
  for (const edge of cfg.edges) {
    parts.push(`${edge.sourceBlockId}->${edge.targetBlockId}:${edge.kind}`);
  }
  for (const exit of cfg.exits) {
    parts.push(`exit:${exit.blockId}:${exit.kind}`);
  }
  return fnv1a(parts.join("|"));
};

// ../analysis/ref-cfg/extract-cfgs.ts
var makeCfgId = (scene, label) => `${scene.toLowerCase()}:${label}`;
var findEntryPoints = (sceneCfg) => {
  const entryBlockIds = /* @__PURE__ */ new Set();
  entryBlockIds.add(sceneCfg.entryBlockId);
  for (const blockId of Object.values(sceneCfg.labelToBlockId)) {
    entryBlockIds.add(blockId);
  }
  const blockIdToLabel = /* @__PURE__ */ new Map();
  blockIdToLabel.set(sceneCfg.entryBlockId, "");
  for (const [label, blockId] of Object.entries(sceneCfg.labelToBlockId)) {
    blockIdToLabel.set(blockId, label);
  }
  const edgesBySource = buildEdgesBySource(sceneCfg.edges);
  const ownerLabel = resolveBlockOwners(entryBlockIds, blockIdToLabel, edgesBySource);
  const contCounters = /* @__PURE__ */ new Map();
  for (const edge of sceneCfg.edges) {
    if (!isGoSubReturn(edge.kind) || !edge.targetBlockId) continue;
    if (entryBlockIds.has(edge.targetBlockId)) continue;
    const sourceEdges = edgesBySource.get(edge.sourceBlockId) ?? [];
    const hasCall = sourceEdges.some((e) => isGoSubCall(e.kind));
    if (!hasCall) continue;
    entryBlockIds.add(edge.targetBlockId);
    if (!blockIdToLabel.has(edge.targetBlockId)) {
      const parent = ownerLabel.get(edge.sourceBlockId) ?? "";
      const idx = contCounters.get(parent) ?? 0;
      contCounters.set(parent, idx + 1);
      const prefix = parent || "__entry";
      blockIdToLabel.set(edge.targetBlockId, `${prefix}__cont_${idx}`);
    }
  }
  return { entryBlockIds, blockIdToLabel, edgesBySource };
};
var extractCfgs = (sceneName, sceneCfg, statements, cache) => {
  const ep = findEntryPoints(sceneCfg);
  const results = [];
  for (const entryId of ep.entryBlockIds) {
    const label = ep.blockIdToLabel.get(entryId);
    const cfg = extractStructure(
      sceneName,
      label,
      entryId,
      ep.entryBlockIds,
      ep.blockIdToLabel,
      sceneCfg.blocks,
      ep.edgesBySource
    );
    const hash = cache ? hashCfg(cfg, sceneCfg.blockIndex, statements) : "";
    const cached = cache?.lookup(cfg.id, hash);
    if (cached) {
      results.push({ cfg, transfer: cached.transfer, scope: cached.scope, variables: cached.variables, casing: cached.casing });
      continue;
    }
    const transferPass = new TransferPass();
    const scopePass = new ScopePass();
    const variablePass = new SymbolTablePass();
    const casingPass = new CasingPass();
    runCfgVisitors(cfg, sceneCfg.blockIndex, statements, [transferPass, scopePass, variablePass, casingPass]);
    const transfer = transferPass.finish(cfg);
    const scope = scopePass.finish(cfg);
    const variables = variablePass.finish(cfg);
    const casing = casingPass.finish(cfg);
    cache?.store(cfg.id, hash, { transfer, scope, variables, casing });
    results.push({ cfg, transfer, scope, variables, casing });
  }
  return results;
};
var runCfgVisitors = (cfg, blockIndex, statements, visitors) => {
  const order = topologicalBlockOrder(cfg.blocks, cfg.edges);
  const edgesByTarget = buildEdgesByTarget(cfg);
  const idom = computeDominators(cfg.entryBlockId, order, edgesByTarget);
  const blockGuards = /* @__PURE__ */ new Map();
  blockGuards.set(cfg.entryBlockId, []);
  const scopeNodes = /* @__PURE__ */ new Map();
  for (const blockId of order) {
    if (!blockGuards.has(blockId)) {
      const inEdges2 = edgesByTarget.get(blockId) ?? [];
      if (inEdges2.length === 1) {
        const edge = inEdges2[0];
        const parentGuards = blockGuards.get(edge.sourceBlockId) ?? [];
        if (isBranchEdge(edge)) {
          blockGuards.set(blockId, [
            ...parentGuards,
            { branchBlockId: edge.sourceBlockId, edgeKind: edge.kind, metadata: edge.metadata }
          ]);
        } else {
          blockGuards.set(blockId, parentGuards);
        }
      } else {
        const dom = idom.get(blockId);
        blockGuards.set(blockId, dom ? blockGuards.get(dom) ?? [] : []);
      }
    }
    const block = blockIndex[blockId];
    if (!block) continue;
    const guards = blockGuards.get(blockId);
    const inEdges = edgesByTarget.get(blockId) ?? [];
    let parentNode = null;
    let merged = false;
    if (blockId === cfg.entryBlockId) {
      parentNode = null;
    } else if (inEdges.length === 1) {
      parentNode = scopeNodes.get(inEdges[0].sourceBlockId) ?? null;
    } else {
      const dom = idom.get(blockId);
      parentNode = dom ? scopeNodes.get(dom) ?? null : null;
      merged = true;
    }
    const scopeNode = {
      blockId,
      parent: parentNode,
      defs: [],
      deletes: /* @__PURE__ */ new Set(),
      merged
    };
    scopeNodes.set(blockId, scopeNode);
    const ctx = {
      blockId,
      guards,
      guarded: guards.length > 0,
      scopeNode
    };
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      for (const v of visitors) {
        v.onStatement(ctx, stmtId, stmt);
      }
    }
  }
  for (let i = 0; i < cfg.exits.length; i++) {
    const exit = cfg.exits[i];
    const guards = blockGuards.get(exit.blockId) ?? [];
    const exitCtx = {
      exitIndex: i,
      exit,
      guards,
      conditional: guards.some((g) => g.metadata.conditionStatementId != null),
      scopeNode: scopeNodes.get(exit.blockId) ?? null
    };
    for (const v of visitors) {
      v.onExit?.(exitCtx);
    }
  }
};
var extractStructure = (sceneName, label, entryBlockId, allEntryPoints, blockIdToLabel, allBlocks, edgesBySource) => {
  const id = makeCfgId(sceneName, label);
  const blocks = {};
  const internalEdges = [];
  const exits = [];
  const visited = /* @__PURE__ */ new Set();
  const queue = [entryBlockId];
  let qi = 0;
  while (qi < queue.length) {
    const blockId = queue[qi++];
    if (visited.has(blockId)) continue;
    visited.add(blockId);
    const ref = allBlocks[blockId];
    if (!ref) continue;
    blocks[blockId] = ref;
    const outEdges = edgesBySource.get(blockId) ?? [];
    for (const edge of outEdges) {
      if (isGoSubReturn(edge.kind)) continue;
      if (!edge.targetBlockId) {
        const target = edge.kind === "Return" ? { type: "return" } : edge.kind === "GameEnd" ? { type: "terminal" } : { type: "unresolved" };
        const exit = { blockId, kind: edge.kind, target, metadata: edge.metadata };
        if (isGoSubCall(edge.kind)) {
          const contBlockId = findContinuation(blockId, edgesBySource);
          if (contBlockId) {
            const contLabel = blockIdToLabel.get(contBlockId);
            if (contLabel !== void 0) {
              exit.continuation = makeCfgId(sceneName, contLabel);
            }
          }
        }
        exits.push(exit);
        continue;
      }
      if (allEntryPoints.has(edge.targetBlockId)) {
        const targetLabel = blockIdToLabel.get(edge.targetBlockId);
        const exit = {
          blockId,
          kind: edge.kind,
          target: { type: "cfg", cfgId: makeCfgId(sceneName, targetLabel) },
          metadata: edge.metadata
        };
        if (isGoSubCall(edge.kind)) {
          const contBlockId = findContinuation(blockId, edgesBySource);
          if (contBlockId) {
            const contLabel = blockIdToLabel.get(contBlockId);
            if (contLabel !== void 0) {
              exit.continuation = makeCfgId(sceneName, contLabel);
            }
          }
        }
        exits.push(exit);
        continue;
      }
      internalEdges.push(edge);
      if (!visited.has(edge.targetBlockId)) {
        queue.push(edge.targetBlockId);
      }
    }
  }
  for (const edge of internalEdges) {
    if (!blocks[edge.targetBlockId]) {
      throw new Error(
        `CFG "${id}": internal edge from "${edge.sourceBlockId}" targets "${edge.targetBlockId}" which is not in this CFG`
      );
    }
    if (isNavigationEdge(edge.kind)) {
      throw new Error(
        `CFG "${id}": navigation edge kind "${edge.kind}" from "${edge.sourceBlockId}" must be an exit, not an internal edge`
      );
    }
  }
  return { id, scene: sceneName, entryBlockId, blocks, edges: internalEdges, exits };
};
var resolveBlockOwners = (entryBlockIds, blockIdToLabel, edgesBySource) => {
  const owner = /* @__PURE__ */ new Map();
  for (const entryId of entryBlockIds) {
    const label = blockIdToLabel.get(entryId);
    const visited = /* @__PURE__ */ new Set();
    const queue = [entryId];
    let qi = 0;
    while (qi < queue.length) {
      const blockId = queue[qi++];
      if (visited.has(blockId)) continue;
      visited.add(blockId);
      owner.set(blockId, label);
      for (const edge of edgesBySource.get(blockId) ?? []) {
        if (!edge.targetBlockId) continue;
        if (entryBlockIds.has(edge.targetBlockId) && edge.targetBlockId !== entryId) continue;
        if (isGoSubReturn(edge.kind)) continue;
        queue.push(edge.targetBlockId);
      }
    }
  }
  return owner;
};
var findContinuation = (blockId, edgesBySource) => {
  const edges = edgesBySource.get(blockId) ?? [];
  for (const edge of edges) {
    if (isGoSubReturn(edge.kind) && edge.targetBlockId) {
      return edge.targetBlockId;
    }
  }
  return void 0;
};
var navigationEdgeKinds = /* @__PURE__ */ new Set([
  "Goto",
  "GotoScene",
  "GoSubCall",
  "GoSubSceneCall",
  "SceneExit",
  "SceneProgression",
  "GameEnd",
  "Return"
]);
var isNavigationEdge = (kind) => navigationEdgeKinds.has(kind);
var isBranchEdge = (edge) => isConditionalBranch(edge.kind) || isChoiceOptionEdge(edge.kind);
var buildEdgesByTarget = (cfg) => {
  const map = /* @__PURE__ */ new Map();
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId || !cfg.blocks[edge.targetBlockId]) continue;
    getOrSet(map, edge.targetBlockId, () => []).push({
      sourceBlockId: edge.sourceBlockId,
      kind: edge.kind,
      metadata: edge.metadata
    });
  }
  return map;
};
var computeDominators = (entryId, order, edgesByTarget) => {
  const orderIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < order.length; i++) {
    orderIndex.set(order[i], i);
  }
  const idom = /* @__PURE__ */ new Map();
  idom.set(entryId, entryId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const blockId of order) {
      if (blockId === entryId) continue;
      const preds = (edgesByTarget.get(blockId) ?? []).map((e) => e.sourceBlockId).filter((p) => idom.has(p));
      if (preds.length === 0) continue;
      let newIdom = preds[0];
      for (let i = 1; i < preds.length; i++) {
        newIdom = intersect(newIdom, preds[i], idom, orderIndex);
      }
      if (idom.get(blockId) !== newIdom) {
        idom.set(blockId, newIdom);
        changed = true;
      }
    }
  }
  return idom;
};
var intersect = (a, b, idom, orderIndex) => {
  let fingerA = a;
  let fingerB = b;
  while (fingerA !== fingerB) {
    const idxA = orderIndex.get(fingerA) ?? 0;
    const idxB = orderIndex.get(fingerB) ?? 0;
    if (idxA > idxB) {
      fingerA = idom.get(fingerA) ?? fingerA;
    } else {
      fingerB = idom.get(fingerB) ?? fingerB;
    }
    if (fingerA === idom.get(fingerA) && fingerB === idom.get(fingerB)) break;
  }
  return fingerA;
};

// ../analysis/ref-cfg/reconcile.ts
var nullWriter = {
  write() {
  },
  flush() {
  }
};
var emptyDelta = () => ({
  scenes: /* @__PURE__ */ new Set(),
  cfgIds: /* @__PURE__ */ new Set(),
  blockIds: /* @__PURE__ */ new Set(),
  statementIds: /* @__PURE__ */ new Set()
});
var CfgReconciler = class {
  sceneCache;
  cfgCache;
  blockWriter;
  lastPlan = null;
  blockToCfg = /* @__PURE__ */ new Map();
  stmtToBlock = /* @__PURE__ */ new Map();
  constructor(opts = {}) {
    this.sceneCache = opts.sceneCache ?? null;
    this.cfgCache = opts.cfgCache ?? null;
    this.blockWriter = opts.blockWriter ?? null;
  }
  reconcile(scenes) {
    const dirtyScenes = /* @__PURE__ */ new Set();
    const sceneCfgs = /* @__PURE__ */ new Map();
    for (const scene of scenes) {
      const cached = this.sceneCache?.lookup(scene.name, scene.statements);
      if (cached) {
        sceneCfgs.set(scene.name, cached);
        continue;
      }
      dirtyScenes.add(scene.name);
      const cfg = buildControlFlow(scene, this.blockWriter ?? nullWriter);
      sceneCfgs.set(scene.name, cfg);
      this.sceneCache?.store(scene.name, scene.statements, cfg);
      this.cfgCache?.pruneScene(scene.name);
    }
    const statements = buildStatementIndex(scenes);
    const blockIndex = buildBlockIndex(sceneCfgs);
    const cfgs = {};
    const transfers = /* @__PURE__ */ new Map();
    const scopes = /* @__PURE__ */ new Map();
    const allVariables = [];
    const allCasing = [];
    for (const scene of scenes) {
      const sceneCfg = sceneCfgs.get(scene.name);
      if (!sceneCfg) continue;
      const extracted = extractCfgs(scene.name, sceneCfg, statements, this.cfgCache ?? void 0);
      for (const { cfg, transfer, scope, variables, casing } of extracted) {
        cfgs[cfg.id] = cfg;
        transfers.set(cfg.id, transfer);
        scopes.set(cfg.id, scope);
        allVariables.push(variables);
        allCasing.push(...casing);
      }
    }
    this.rebuildIndexes(cfgs, blockIndex);
    const dirty = this.resolveFromScenes(dirtyScenes, cfgs, blockIndex);
    const plan = { cfgs, transfers, scopes, variables: allVariables, casing: allCasing, statements, blockIndex, sceneCfgs, dirty };
    this.lastPlan = plan;
    return plan;
  }
  resolveLines(lines) {
    if (!this.lastPlan) return emptyDelta();
    const lineKeys = new Set(lines.map((d) => `${d.scene}:${d.line}`));
    const statementIds = /* @__PURE__ */ new Set();
    for (const [stmtId, stmt] of Object.entries(this.lastPlan.statements)) {
      const token = stmt.token;
      if (token && lineKeys.has(`${token.sceneName}:${token.lineNumber}`)) {
        statementIds.add(stmtId);
      }
    }
    return this.resolveFromStatements(statementIds);
  }
  resolveStatementIds(stmtIds) {
    return this.resolveFromStatements(new Set(stmtIds));
  }
  resolveBlockIds(blockIds) {
    const scenes = /* @__PURE__ */ new Set();
    const set2 = new Set(blockIds);
    const cfgIds = /* @__PURE__ */ new Set();
    for (const blockId of set2) {
      const cfgId = this.blockToCfg.get(blockId);
      if (cfgId) {
        cfgIds.add(cfgId);
        const cfg = this.lastPlan?.cfgs[cfgId];
        if (cfg) scenes.add(cfg.scene);
      }
    }
    return { scenes, cfgIds, blockIds: set2, statementIds: /* @__PURE__ */ new Set() };
  }
  stats() {
    const scene = this.sceneCache?.stats() ?? { hits: 0, misses: 0 };
    const cfg = this.cfgCache?.stats() ?? { hits: 0, misses: 0 };
    return {
      scenes: { total: scene.hits + scene.misses, cached: scene.hits, built: scene.misses },
      cfgs: { total: cfg.hits + cfg.misses, cached: cfg.hits, computed: cfg.misses }
    };
  }
  rebuildIndexes(cfgs, blockIndex) {
    this.blockToCfg.clear();
    this.stmtToBlock.clear();
    for (const cfg of Object.values(cfgs)) {
      for (const blockId of Object.keys(cfg.blocks)) {
        this.blockToCfg.set(blockId, cfg.id);
      }
    }
    for (const [blockId, block] of Object.entries(blockIndex)) {
      for (const sid of block.statementIds) {
        this.stmtToBlock.set(sid, blockId);
      }
    }
  }
  resolveFromScenes(dirtyScenes, cfgs, blockIndex) {
    const scenes = new Set(dirtyScenes);
    const cfgIds = /* @__PURE__ */ new Set();
    const blockIds = /* @__PURE__ */ new Set();
    const statementIds = /* @__PURE__ */ new Set();
    for (const cfg of Object.values(cfgs)) {
      if (!dirtyScenes.has(cfg.scene)) continue;
      cfgIds.add(cfg.id);
      for (const blockId of Object.keys(cfg.blocks)) {
        blockIds.add(blockId);
        const block = blockIndex[blockId];
        if (block) {
          for (const sid of block.statementIds) statementIds.add(sid);
        }
      }
    }
    return { scenes, cfgIds, blockIds, statementIds };
  }
  resolveFromStatements(statementIds) {
    const scenes = /* @__PURE__ */ new Set();
    const blockIds = /* @__PURE__ */ new Set();
    const cfgIds = /* @__PURE__ */ new Set();
    for (const sid of statementIds) {
      const blockId = this.stmtToBlock.get(sid);
      if (!blockId) continue;
      blockIds.add(blockId);
      const cfgId = this.blockToCfg.get(blockId);
      if (cfgId) {
        cfgIds.add(cfgId);
        const cfg = this.lastPlan?.cfgs[cfgId];
        if (cfg) scenes.add(cfg.scene);
      }
    }
    return { scenes, cfgIds, blockIds, statementIds };
  }
};
var buildStatementIndex = (scenes) => {
  const index = {};
  for (const scene of scenes) {
    const walk = (stmts) => {
      for (const stmt of stmts) {
        index[`${scene.name}:${stmt.statementId}`] = stmt;
        if ("body" in stmt && Array.isArray(stmt.body)) {
          walk(stmt.body);
        }
        if ("options" in stmt && Array.isArray(stmt.options)) {
          for (const opt of stmt.options) {
            if (opt.body) walk(opt.body);
          }
        }
        if ("elseIfBranches" in stmt && Array.isArray(stmt.elseIfBranches)) {
          for (const branch of stmt.elseIfBranches) {
            index[`${scene.name}:${branch.statementId}`] = branch;
            if (branch.body) walk(branch.body);
          }
        }
        if ("elseBranch" in stmt && stmt.elseBranch) {
          const branch = stmt.elseBranch;
          index[`${scene.name}:${branch.statementId}`] = branch;
          if (branch.body) walk(branch.body);
        }
      }
    };
    walk(scene.statements);
  }
  return index;
};
var buildBlockIndex = (sceneCfgs) => {
  const index = {};
  for (const [, sceneCfg] of sceneCfgs) {
    for (const [blockId, block] of Object.entries(sceneCfg.blockIndex)) {
      index[blockId] = block;
    }
  }
  return index;
};

// ../analysis/ref-cfg/link-cfgs.ts
var extractSceneOrder = (scenes) => {
  const startup = scenes.find((s) => s.name === "startup");
  if (!startup) {
    const order = scenes.map((s) => s.name);
    return { order, sceneListScenes: new Set(order) };
  }
  const sceneListStmt = startup.statements.find((s) => s.kind === "SceneList");
  if (!sceneListStmt) {
    const order = scenes.map((s) => s.name);
    return { order, sceneListScenes: new Set(order) };
  }
  const ordered = ["startup"];
  for (const id of sceneListStmt.identifiers) {
    if (id.value !== "startup") ordered.push(id.value);
  }
  const sceneListScenes = new Set(ordered);
  for (const scene of scenes) {
    if (!sceneListScenes.has(scene.name)) ordered.push(scene.name);
  }
  return { order: ordered, sceneListScenes };
};
var linkCfgs = (scenes, allCfgs, sceneCfgs) => {
  const { order: sceneOrder, sceneListScenes } = extractSceneOrder(scenes);
  const unresolvedExits = [];
  for (const cfg of Object.values(allCfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type !== "unresolved" && exit.target.type !== "terminal") continue;
      if (exit.kind === "GotoScene" && exit.metadata.targetScene) {
        const targetScene = exit.metadata.targetScene;
        const targetLabel = exit.metadata.targetSceneLabel ?? "";
        const resolved = makeCfgId(targetScene, targetLabel);
        if (allCfgs[resolved]) {
          exit.target = { type: "cfg", cfgId: resolved };
        } else {
          exit.target = { type: "unresolved" };
          unresolvedExits.push(exit);
        }
        continue;
      }
      if (exit.kind === "GoSubSceneCall" && exit.metadata.targetScene) {
        const targetScene = exit.metadata.targetScene;
        const label = exit.metadata.label ?? "";
        const resolved = makeCfgId(targetScene, label);
        if (allCfgs[resolved]) {
          exit.target = { type: "cfg", cfgId: resolved };
        } else {
          exit.target = { type: "unresolved" };
          unresolvedExits.push(exit);
        }
        continue;
      }
      if (exit.kind === "SceneExit") {
        if (sceneListScenes.has(cfg.scene)) {
          const sceneIdx = sceneOrder.indexOf(cfg.scene);
          if (sceneIdx >= 0 && sceneIdx < sceneOrder.length - 1) {
            const nextScene = sceneOrder[sceneIdx + 1];
            if (sceneListScenes.has(nextScene)) {
              const nextId = makeCfgId(nextScene, "");
              if (allCfgs[nextId]) {
                exit.kind = "SceneProgression";
                exit.target = { type: "cfg", cfgId: nextId };
                continue;
              }
            }
          }
        }
        exit.target = { type: "terminal" };
        continue;
      }
      unresolvedExits.push(exit);
    }
  }
  const statsCfgIds = [];
  for (const cfg of Object.values(allCfgs)) {
    if (cfg.scene === "choicescript_stats") statsCfgIds.push(cfg.id);
  }
  const statementIndex = {};
  for (const [sceneName, sceneCfg] of sceneCfgs) {
    for (const [blockId, codeBlock] of Object.entries(sceneCfg.blockIndex)) {
      for (const stmtId of codeBlock.statementIds) {
        const colonIdx = stmtId.indexOf(":");
        const localId = colonIdx >= 0 ? stmtId.slice(colonIdx + 1) : stmtId;
        statementIndex[stmtId] = {
          scene: sceneName,
          localStatementId: localId,
          blockId
        };
      }
    }
  }
  const startupEntry = makeCfgId("startup", "");
  const entryCfgId = allCfgs[startupEntry] ? startupEntry : Object.keys(allCfgs)[0];
  return {
    cfgs: allCfgs,
    loops: {},
    unresolvedExits,
    sceneOrder: sceneOrder.filter((s) => s !== "choicescript_stats"),
    entryCfgId,
    statementIndex,
    statsCfgIds
  };
};

// ../analysis/ref-cfg/loop-analysis.ts
var analyseCfgLoops = (linked, transfers, blockToCfg, cfgSuccessors, blockIndex = {}, statements = {}) => {
  const { loopHeaders, backEdgeExits } = detectBackEdgeExits(linked, cfgSuccessors);
  const backEdgesByHeader = /* @__PURE__ */ new Map();
  for (const exit of backEdgeExits) {
    if (exit.target.type !== "cfg") continue;
    getOrSet(backEdgesByHeader, exit.target.cfgId, () => []).push(exit);
  }
  const loops = [];
  for (const headerId of loopHeaders) {
    const backEdges = backEdgesByHeader.get(headerId) ?? [];
    const body = findLoopBody(headerId, backEdges, linked, cfgSuccessors, blockToCfg);
    const exitLinks = findLoopExits(body, linked);
    const classification = classifyLoop(body, backEdges, exitLinks, linked, transfers, blockIndex, statements);
    loops.push({
      headerCfgId: headerId,
      bodyCfgIds: [...body],
      backEdges,
      exitLinks,
      classification
    });
  }
  const cfgToLoop = /* @__PURE__ */ new Map();
  for (const loop2 of loops) {
    for (const cfgId of loop2.bodyCfgIds) {
      cfgToLoop.set(cfgId, loop2);
    }
  }
  for (const loop2 of loops) {
    const c = loop2.classification;
    const ref = {
      id: loop2.headerCfgId,
      headerCfgId: loop2.headerCfgId,
      bodyCfgIds: loop2.bodyCfgIds,
      backEdges: loop2.backEdges,
      exits: loop2.exitLinks,
      mechanism: c.mechanism,
      pure: c.pure,
      bound: c.bound,
      tripCount: c.tripCount,
      unrollDepth: c.unrollDepth,
      infinite: c.infinite,
      infiniteCondition: c.infiniteCondition
    };
    linked.loops[ref.id] = ref;
  }
  return { loops, loopHeaders, cfgToLoop };
};
var detectBackEdgeExits = (linked, successors) => {
  const visited = /* @__PURE__ */ new Set();
  const inStack = /* @__PURE__ */ new Set();
  const loopHeaders = /* @__PURE__ */ new Set();
  const backEdgePairs = /* @__PURE__ */ new Set();
  const stack = [];
  stack.push({ cfgId: linked.entryCfgId });
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame.iter) {
      if (visited.has(frame.cfgId)) {
        if (inStack.has(frame.cfgId)) {
          loopHeaders.add(frame.cfgId);
          const parent = stack.length >= 2 ? stack[stack.length - 2] : void 0;
          if (parent) backEdgePairs.add(`${parent.cfgId}->${frame.cfgId}`);
        }
        stack.pop();
        continue;
      }
      visited.add(frame.cfgId);
      inStack.add(frame.cfgId);
      const succs = successors.get(frame.cfgId);
      frame.iter = succs ? succs.values() : [][Symbol.iterator]();
    }
    const next = frame.iter.next();
    if (next.done) {
      inStack.delete(frame.cfgId);
      stack.pop();
    } else {
      stack.push({ cfgId: next.value });
    }
  }
  const backEdgeExits = [];
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg") continue;
      if (backEdgePairs.has(`${cfg.id}->${exit.target.cfgId}`)) {
        backEdgeExits.push(exit);
      }
    }
  }
  return { loopHeaders, backEdgeExits };
};
var findLoopBody = (headerId, backEdges, linked, successors, blockToCfg) => {
  const reachableFromHeader = /* @__PURE__ */ new Set();
  const fwdQueue = [headerId];
  while (fwdQueue.length > 0) {
    const id = fwdQueue.pop();
    if (reachableFromHeader.has(id)) continue;
    reachableFromHeader.add(id);
    for (const succ of successors.get(id) ?? []) {
      fwdQueue.push(succ);
    }
  }
  const predecessors = /* @__PURE__ */ new Map();
  for (const [from, succs] of successors) {
    for (const to of succs) {
      getOrSet(predecessors, to, () => /* @__PURE__ */ new Set()).add(from);
    }
  }
  const body = /* @__PURE__ */ new Set([headerId]);
  const queue = [];
  for (const be of backEdges) {
    const srcCfg = blockToCfg.get(be.blockId);
    if (srcCfg && !body.has(srcCfg) && reachableFromHeader.has(srcCfg)) {
      body.add(srcCfg);
      queue.push(srcCfg);
    }
  }
  while (queue.length > 0) {
    const cfgId = queue.pop();
    for (const pred of predecessors.get(cfgId) ?? []) {
      if (!body.has(pred) && reachableFromHeader.has(pred)) {
        body.add(pred);
        queue.push(pred);
      }
    }
  }
  return body;
};
var findLoopExits = (body, linked) => {
  const exits = [];
  for (const cfgId of body) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    for (const exit of cfg.exits) {
      if (exit.target.type === "terminal" || exit.target.type === "return") {
        exits.push(exit);
      } else if (exit.target.type === "cfg" && !body.has(exit.target.cfgId)) {
        exits.push(exit);
      }
    }
  }
  return exits;
};
var exprToCondition = (expr) => {
  if (!expr) return null;
  if (expr.kind === "Grouping") return exprToCondition(expr.expression);
  if (expr.kind === "Binary") {
    const opType = expr.operator?.type;
    if (opType === "LogicalAnd") {
      const left2 = exprToCondition(expr.left);
      const right2 = exprToCondition(expr.right);
      if (!left2 || !right2) return null;
      return simplifyCondition({ type: "and", operands: [left2, right2] });
    }
    if (opType === "LogicalOr") {
      const left2 = exprToCondition(expr.left);
      const right2 = exprToCondition(expr.right);
      if (!left2 || !right2) return null;
      return simplifyCondition({ type: "or", operands: [left2, right2] });
    }
    const left = exprToCondition(expr.left);
    const right = exprToCondition(expr.right);
    if (!left || !right || !opType) return null;
    return { type: "comparison", operator: opType, left, right };
  }
  if (expr.kind === "Unary" && expr.operator?.type === "NotOperator") {
    const inner = exprToCondition(expr.value);
    if (!inner) return null;
    return simplifyCondition({ type: "not", operand: inner });
  }
  if (expr.kind === "Identifier" && expr.token?.value) {
    return { type: "var", name: expr.token.value };
  }
  if (expr.kind === "Literal") {
    const v = expr.value;
    if (v?.type === "BooleanLiteral") return { type: "literal", value: v.value };
    if (v?.type === "NumberLiteral") return { type: "literal", value: v.value };
    if (v?.type === "StringLiteral") return { type: "literal", value: v.value };
  }
  return null;
};
var negateComparisonOp = (op) => {
  switch (op) {
    case "EqualityOperator":
      return "NotEqualityOperator";
    case "NotEqualityOperator":
      return "EqualityOperator";
    case "GreaterThanOperator":
      return "LessThanEqualsOperator";
    case "LessThanOperator":
      return "GreaterThanEqualsOperator";
    case "GreaterThanEqualsOperator":
      return "LessThanOperator";
    case "LessThanEqualsOperator":
      return "GreaterThanOperator";
    default:
      return null;
  }
};
var negateCondition = (c) => {
  if (c.type === "literal" && typeof c.value === "boolean") {
    return { type: "literal", value: !c.value };
  }
  if (c.type === "comparison") {
    const neg = negateComparisonOp(c.operator);
    if (neg) return { type: "comparison", operator: neg, left: c.left, right: c.right };
  }
  if (c.type === "not") return c.operand;
  if (c.type === "and") return simplifyCondition({ type: "or", operands: c.operands.map(negateCondition) });
  if (c.type === "or") return simplifyCondition({ type: "and", operands: c.operands.map(negateCondition) });
  if (c.type === "unconditional") return { type: "literal", value: false };
  return { type: "not", operand: c };
};
var simplifyCondition = (c) => {
  if (c.type === "and") {
    const flat = [];
    for (const op of c.operands) {
      const s = simplifyCondition(op);
      if (s.type === "literal" && s.value === false) return { type: "literal", value: false };
      if (s.type === "literal" && s.value === true) continue;
      if (s.type === "and") flat.push(...s.operands);
      else flat.push(s);
    }
    if (flat.length === 0) return { type: "literal", value: true };
    if (flat.length === 1) return flat[0];
    return { type: "and", operands: flat };
  }
  if (c.type === "or") {
    const flat = [];
    for (const op of c.operands) {
      const s = simplifyCondition(op);
      if (s.type === "literal" && s.value === true) return { type: "literal", value: true };
      if (s.type === "literal" && s.value === false) continue;
      if (s.type === "or") flat.push(...s.operands);
      else flat.push(s);
    }
    if (flat.length === 0) return { type: "literal", value: false };
    if (flat.length === 1) return flat[0];
    return { type: "or", operands: flat };
  }
  if (c.type === "not") {
    const inner = simplifyCondition(c.operand);
    if (inner.type === "literal" && typeof inner.value === "boolean") {
      return { type: "literal", value: !inner.value };
    }
    if (inner.type === "not") return inner.operand;
    return { type: "not", operand: inner };
  }
  return c;
};
var conditionForEdge = (expression, edgeKind) => {
  const cond = exprToCondition(expression);
  if (!cond) return null;
  const isTaken = edgeKind === "IfBranch" || edgeKind === "ElseIfBranch";
  return isTaken ? cond : negateCondition(cond);
};
var guardToCondition = (guard, statements) => {
  const condId = guard.metadata.conditionStatementId;
  if (!condId) return null;
  const stmt = statements[condId];
  if (!stmt?.expression) return null;
  return conditionForEdge(stmt.expression, guard.edgeKind);
};
var guardsToCondition = (guards, statements) => {
  const parts = [];
  for (const g of guards) {
    if (isChoiceOptionEdge(g.edgeKind)) {
      if (g.metadata.choiceConditionId) {
        const stmt = statements[g.metadata.choiceConditionId];
        if (stmt?.expression) {
          const cond2 = exprToCondition(stmt.expression);
          if (cond2) parts.push(cond2);
          else return null;
        }
      }
      continue;
    }
    const cond = guardToCondition(g, statements);
    if (cond) parts.push(cond);
    else if (g.metadata.conditionStatementId) return null;
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return simplifyCondition({ type: "and", operands: parts });
};
var buildInfiniteCondition = (exitLinks, body, linked, transfers, statements) => {
  if (exitLinks.length === 0) return null;
  const negatedExits = [];
  for (const cfgId of body) {
    const transfer = transfers.get(cfgId);
    if (!transfer) continue;
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    for (const exitGuard of transfer.exits) {
      const exit = cfg.exits[exitGuard.exitIndex];
      if (!exit) continue;
      const isLoopExit = exit.target.type === "terminal" || exit.target.type === "return" || exit.target.type === "cfg" && !body.has(exit.target.cfgId);
      if (!isLoopExit) continue;
      if (!exitGuard.conditional) return null;
      const cond = guardsToCondition(exitGuard.guards, statements);
      if (!cond) return null;
      negatedExits.push(negateCondition(cond));
    }
  }
  if (negatedExits.length === 0) return null;
  const combined = simplifyCondition({ type: "and", operands: negatedExits });
  if (combined.type === "literal" && combined.value === false) return null;
  return combined;
};
var classifyLoop = (body, backEdges, exitLinks, linked, transfers, blockIndex, statements) => {
  const mechanism = classifyMechanism(body, backEdges, linked);
  const pure = !hasEffectsInBody(body, transfers);
  const bound = classifyBound(body, backEdges, exitLinks, linked, transfers, blockIndex, statements);
  const tripCount = computeTripCount(bound, body, exitLinks, linked, blockIndex, statements);
  const unrollDepth = computeUnrollDepth(bound, tripCount);
  const infinite = exitLinks.length === 0 ? bound === "unbounded" ? "unbounded-infinite" : "bounded-infinite" : false;
  const infiniteCondition = buildInfiniteCondition(exitLinks, body, linked, transfers, statements);
  return { mechanism, pure, bound, tripCount, unrollDepth, infinite, infiniteCondition };
};
var classifyMechanism = (body, backEdges, linked) => {
  let hasGotoScene = false;
  let hasGoSub = false;
  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg") continue;
      if (!body.has(exit.target.cfgId)) continue;
      if (exit.kind === "GotoScene" || exit.kind === "SceneProgression") hasGotoScene = true;
      if (isGoSubCall(exit.kind)) hasGoSub = true;
    }
  }
  for (const be of backEdges) {
    if (be.kind === "GotoScene" || be.kind === "SceneProgression") hasGotoScene = true;
    if (isGoSubCall(be.kind)) hasGoSub = true;
  }
  if (hasGotoScene && hasGoSub) return "mixed";
  if (hasGoSub) return "call-chain";
  if (hasGotoScene) return "cross-scene";
  return "direct";
};
var hasEffectsInBody = (body, transfers) => {
  for (const cfgId of body) {
    const transfer = transfers.get(cfgId);
    if (transfer && transfer.effects.length > 0) return true;
  }
  return false;
};
var classifyBound = (body, backEdges, exitLinks, linked, transfers, blockIndex, statements) => {
  if (isChoiceBounded(body, linked)) return "choice-bounded";
  if (isConditionBounded(body, exitLinks, backEdges, transfers, linked, blockIndex, statements)) return "condition-bounded";
  if (isInputBounded(body, exitLinks, linked)) return "input-bounded";
  return "unbounded";
};
var isChoiceBounded = (body, linked) => {
  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const edge of cfg.edges) {
      if (isChoiceOptionEdge(edge.kind) && edge.metadata.effectiveReuse) return true;
    }
  }
  return false;
};
var isConditionBounded = (body, exitLinks, backEdges, transfers, linked, blockIndex, statements) => {
  let hasConditionalBranch = false;
  for (const cfgId of body) {
    const transfer = transfers.get(cfgId);
    if (!transfer) continue;
    if (transfer.exits.some((e) => e.conditional)) hasConditionalBranch = true;
  }
  if (!hasConditionalBranch) {
    for (const be of backEdges) {
      if (be.metadata.conditionStatementId) hasConditionalBranch = true;
    }
  }
  if (!hasConditionalBranch) return false;
  return hasSetVariableInBody(body, linked, blockIndex, statements);
};
var isInputBounded = (body, exitLinks, linked) => {
  if (exitLinks.length === 0) return false;
  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const edge of cfg.edges) {
      if (isChoiceOptionEdge(edge.kind)) return true;
    }
  }
  return false;
};
var computeTripCount = (bound, body, exitLinks, linked, blockIndex, statements) => {
  switch (bound) {
    case "input-bounded":
      return 1;
    case "condition-bounded":
      return computeConditionBoundedTripCount(body, exitLinks, linked, blockIndex, statements);
    case "choice-bounded":
      return countReuseTripCount(body, linked);
    case "unbounded":
      return null;
  }
};
var MAX_UNROLL_DEPTH = 50;
var computeUnrollDepth = (bound, tripCount) => {
  if (tripCount !== null) return Math.min(tripCount, MAX_UNROLL_DEPTH);
  switch (bound) {
    case "condition-bounded":
      return 2;
    case "input-bounded":
      return 1;
    case "choice-bounded":
      return null;
    case "unbounded":
      return null;
  }
};
var countReuseTripCount = (body, linked) => {
  let minTrips = null;
  for (const cfg of iterateBodyCfgs(body, linked)) {
    let totalOptions = 0;
    let reuseCount = 0;
    for (const edge of cfg.edges) {
      if (!isChoiceOptionEdge(edge.kind)) continue;
      totalOptions++;
      const er = edge.metadata.effectiveReuse;
      if (er === "hide_reuse" || er === "disable_reuse") reuseCount++;
    }
    if (reuseCount > 0) {
      const trips = reuseCount + 1;
      if (minTrips === null || trips < minTrips) minTrips = trips;
    }
  }
  return minTrips;
};
var ifBranchLeadsToBody = (targetBlockId, cfg, body) => {
  const visited = /* @__PURE__ */ new Set();
  const queue = [targetBlockId];
  while (queue.length > 0) {
    const blockId = queue.pop();
    if (visited.has(blockId)) continue;
    visited.add(blockId);
    for (const edge of cfg.edges) {
      if (edge.sourceBlockId !== blockId) continue;
      if (edge.targetBlockId) queue.push(edge.targetBlockId);
    }
  }
  for (const exit of cfg.exits) {
    if (!visited.has(exit.blockId)) continue;
    if (exit.target.type === "cfg" && body.has(exit.target.cfgId)) return true;
    if (exit.continuation && body.has(exit.continuation)) return true;
  }
  return false;
};
var hasSetVariableInBody = (body, linked, blockIndex, statements) => {
  for (const cfg of iterateBodyAndGosubCfgs(body, linked)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      const block = blockIndex[blockId];
      if (!block) continue;
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (stmt && stmt.kind === "SetVariable") return true;
      }
    }
  }
  return false;
};
function* iterateBodyAndGosubCfgs(body, linked) {
  const visited = /* @__PURE__ */ new Set();
  const queue = [...body];
  const inSubroutine = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const cfgId = queue.pop();
    if (visited.has(cfgId)) continue;
    visited.add(cfgId);
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    yield cfg;
    const followAll = inSubroutine.has(cfgId);
    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.target.type === "cfg" && !visited.has(exit.target.cfgId)) {
        inSubroutine.add(exit.target.cfgId);
        queue.push(exit.target.cfgId);
      } else if (followAll && exit.target.type === "cfg" && !visited.has(exit.target.cfgId)) {
        inSubroutine.add(exit.target.cfgId);
        queue.push(exit.target.cfgId);
      }
      if (followAll && exit.continuation && !visited.has(exit.continuation)) {
        inSubroutine.add(exit.continuation);
        queue.push(exit.continuation);
      }
    }
  }
}
function* iterateBodyCfgs(body, linked) {
  for (const cfgId of body) {
    const cfg = linked.cfgs[cfgId];
    if (cfg) yield cfg;
  }
}
var computeConditionBoundedTripCount = (body, exitLinks, linked, blockIndex, statements) => {
  const increments = findCounterIncrements(body, linked, blockIndex, statements);
  if (increments.length === 0) return null;
  const conditions = findExitConditions(body, exitLinks, linked, statements);
  if (conditions.length === 0) return null;
  for (const inc of increments) {
    for (const cond of conditions) {
      if (cond.variable !== inc.variable) continue;
      const initial = findInitialValue(inc.variable, linked, blockIndex, statements);
      if (initial === null) continue;
      const trips = computeCounterTrips(initial, inc.step, cond.operator, cond.compareValue);
      if (trips !== null && trips > 0 && trips <= 1e3) return trips;
    }
  }
  return null;
};
var findCounterIncrements = (body, linked, blockIndex, statements) => {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const cfg of iterateBodyAndGosubCfgs(body, linked)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      const block = blockIndex[blockId];
      if (!block) continue;
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (!stmt || stmt.kind !== "SetVariable") continue;
        const effect = extractEffect(stmt);
        if (!effect.defines?.isCompoundAssignment) continue;
        if (!effect.defines.compoundExpression) continue;
        const expr = effect.defines.compoundExpression;
        if (!expr.left || !expr.operator || !expr.right) continue;
        const opType = expr.operator.type;
        if (opType !== "AdditionOperator" && opType !== "SubtractionOperator") continue;
        const varName = effect.defines.variable;
        if (seen.has(varName)) continue;
        const rightVal = extractConstantNumber(expr.right);
        if (rightVal === null) continue;
        const step = opType === "AdditionOperator" ? rightVal : -rightVal;
        if (step === 0) continue;
        seen.add(varName);
        result.push({ variable: varName, step });
      }
    }
  }
  return result;
};
var findExitConditions = (body, exitLinks, linked, statements) => {
  const conditions = [];
  for (const exitEdge of exitLinks) {
    const condStmtId = exitEdge.metadata.conditionStatementId;
    if (!condStmtId) continue;
    const condStmt = statements[condStmtId];
    if (!condStmt?.expression) continue;
    const cond = extractComparisonCondition(condStmt.expression, exitEdge.kind);
    if (cond) conditions.push(cond);
  }
  for (const cfg of iterateBodyCfgs(body, linked)) {
    for (const edge of cfg.edges) {
      if (!isConditionalBranch(edge.kind)) continue;
      if (edge.kind !== "IfBranch" && edge.kind !== "ElseIfBranch") continue;
      const condStmtId = edge.metadata.conditionStatementId;
      if (!condStmtId) continue;
      const condStmt = statements[condStmtId];
      if (!condStmt?.expression) continue;
      const leadsToBody = ifBranchLeadsToBody(edge.targetBlockId, cfg, body);
      const edgeKind = leadsToBody ? "IfFallThrough" : edge.kind;
      const cond = extractComparisonCondition(condStmt.expression, edgeKind);
      if (cond) conditions.push(cond);
    }
  }
  return conditions;
};
var findInitialValue = (varName, linked, blockIndex, statements) => {
  const entryCfg = linked.cfgs[linked.entryCfgId];
  if (!entryCfg) return null;
  const entryBlock = blockIndex[entryCfg.entryBlockId];
  if (!entryBlock) return null;
  for (const stmtId of entryBlock.statementIds) {
    const stmt = statements[stmtId];
    if (!stmt || stmt.kind !== "DeclareVariable") continue;
    const decl = stmt;
    if (decl.variable?.value !== varName) continue;
    return extractConstantNumber(decl.expression);
  }
  return null;
};
var computeCounterTrips = (initial, step, operator, compareValue) => {
  const N = compareValue;
  const I = initial;
  const S = Math.abs(step);
  if (S === 0) return null;
  switch (operator) {
    case "GreaterThanOperator":
      if (step <= 0) return null;
      return Math.floor((N - I) / step) + 1;
    case "GreaterThanEqualsOperator":
      if (step <= 0) return null;
      return Math.ceil((N - I) / step);
    case "LessThanOperator":
      if (step >= 0) return null;
      return Math.floor((I - N) / S) + 1;
    case "LessThanEqualsOperator":
      if (step >= 0) return null;
      return Math.ceil((I - N) / S);
    case "EqualityOperator": {
      const diff = step > 0 ? N - I : I - N;
      if (diff < 0 || diff % S !== 0) return null;
      return diff / S;
    }
    default:
      return null;
  }
};
var extractConstantNumber = (expr) => {
  if (!expr) return null;
  if (expr.kind === "Literal" && expr.value?.type === "NumberLiteral" && typeof expr.value.value === "number") {
    return expr.value.value;
  }
  if (expr.value?.type === "NumberLiteral" && typeof expr.value.value === "number") {
    return expr.value.value;
  }
  return null;
};
var flipComparisonOp = (op) => {
  switch (op) {
    case "EqualityOperator":
      return "EqualityOperator";
    case "NotEqualityOperator":
      return "NotEqualityOperator";
    case "GreaterThanOperator":
      return "LessThanOperator";
    case "LessThanOperator":
      return "GreaterThanOperator";
    case "GreaterThanEqualsOperator":
      return "LessThanEqualsOperator";
    case "LessThanEqualsOperator":
      return "GreaterThanEqualsOperator";
    default:
      return null;
  }
};
var conditionExprToExitCondition = (c) => {
  if (c.type !== "comparison") return null;
  const leftVar = c.left.type === "var" ? c.left.name : null;
  const rightNum = c.right.type === "literal" && typeof c.right.value === "number" ? c.right.value : null;
  if (leftVar !== null && rightNum !== null) {
    return { variable: leftVar, operator: c.operator, compareValue: rightNum };
  }
  const rightVar = c.right.type === "var" ? c.right.name : null;
  const leftNum = c.left.type === "literal" && typeof c.left.value === "number" ? c.left.value : null;
  if (rightVar !== null && leftNum !== null) {
    const flipped = flipComparisonOp(c.operator);
    if (!flipped) return null;
    return { variable: rightVar, operator: flipped, compareValue: leftNum };
  }
  return null;
};
var extractComparisonCondition = (rawExpr, edgeKind) => {
  const cond = conditionForEdge(rawExpr, edgeKind);
  if (!cond) return null;
  return conditionExprToExitCondition(cond);
};

// ../analysis/ref-cfg/cfg-graph.ts
var buildCfgGraph = (linked, blockToCfg) => {
  const edges = buildEdges(linked, blockToCfg);
  const predecessors = /* @__PURE__ */ new Map();
  const successors = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    getOrSet(predecessors, edge.to, () => []).push(edge);
    getOrSet(successors, edge.from, () => []).push(edge.to);
  }
  const order = topologicalOrder(linked, edges);
  return { edges, predecessors, successors, order };
};
var buildEdges = (linked, blockToCfg) => {
  const edges = [];
  const returnTargets = /* @__PURE__ */ new Map();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.continuation) {
        if (exit.target.type === "cfg") {
          edges.push({ from: cfg.id, to: exit.target.cfgId, kind: "call" });
          const contCfgId = linked.cfgs[exit.continuation] ? exit.continuation : blockToCfg?.get(exit.continuation);
          if (contCfgId) {
            getOrSet(returnTargets, exit.target.cfgId, () => /* @__PURE__ */ new Set()).add(contCfgId);
          }
        }
        continue;
      }
      if (exit.target.type === "return") continue;
      if (exit.target.type === "cfg") {
        edges.push({ from: cfg.id, to: exit.target.cfgId, kind: "flow" });
      }
    }
  }
  const flowSuccs = /* @__PURE__ */ new Map();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type === "cfg" && !isGoSubCall(exit.kind)) {
        getOrSet(flowSuccs, cfg.id, () => []).push(exit.target.cfgId);
      }
    }
  }
  for (const [gosubTarget, continuations] of returnTargets) {
    const body = floodFill(gosubTarget, flowSuccs);
    for (const bodyCfgId of body) {
      const cfg = linked.cfgs[bodyCfgId];
      if (!cfg) continue;
      if (cfg.exits.some((e) => e.target.type === "return")) {
        for (const contCfgId of continuations) {
          edges.push({ from: bodyCfgId, to: contCfgId, kind: "return" });
        }
      }
    }
  }
  return edges;
};
var floodFill = (start, flowSuccs) => {
  const visited = /* @__PURE__ */ new Set();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const succ of flowSuccs.get(id) ?? []) {
      stack.push(succ);
    }
  }
  return visited;
};
var topologicalOrder = (linked, edges) => {
  const succs = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const edge of edges) {
    if (edge.kind === "return") continue;
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    getOrSet(succs, edge.from, () => []).push(edge.to);
  }
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (isGoSubCall(exit.kind) && exit.continuation) {
        const contCfgId = linked.cfgs[exit.continuation] ? exit.continuation : void 0;
        if (contCfgId) {
          const key = `${cfg.id}->${contCfgId}`;
          if (!seen.has(key)) {
            seen.add(key);
            getOrSet(succs, cfg.id, () => []).push(contCfgId);
          }
        }
      }
    }
  }
  const sceneIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < linked.sceneOrder.length; i++) {
    sceneIndex.set(linked.sceneOrder[i], i);
  }
  const cfgIds = Object.keys(linked.cfgs);
  const isEntry = (id) => {
    const cfg = linked.cfgs[id];
    return cfg && id === `${cfg.scene}:`;
  };
  cfgIds.sort((a, b) => {
    const cfgA = linked.cfgs[a];
    const cfgB = linked.cfgs[b];
    const sceneA = sceneIndex.get(cfgA?.scene ?? "") ?? Infinity;
    const sceneB = sceneIndex.get(cfgB?.scene ?? "") ?? Infinity;
    if (sceneA !== sceneB) return sceneA - sceneB;
    const entryA = isEntry(a) ? 0 : 1;
    const entryB = isEntry(b) ? 0 : 1;
    return entryA - entryB;
  });
  const visited = /* @__PURE__ */ new Set();
  const postOrder = [];
  const dfs = (id) => {
    const stack = [{ id, childIdx: 0 }];
    visited.add(id);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = succs.get(frame.id) ?? [];
      if (frame.childIdx < children.length) {
        const child = children[frame.childIdx++];
        if (!visited.has(child)) {
          visited.add(child);
          stack.push({ id: child, childIdx: 0 });
        }
      } else {
        postOrder.push(frame.id);
        stack.pop();
      }
    }
  };
  if (linked.entryCfgId && linked.cfgs[linked.entryCfgId]) {
    dfs(linked.entryCfgId);
  }
  const reachableCount = postOrder.length;
  for (const id of cfgIds) {
    if (!visited.has(id)) dfs(id);
  }
  const reachable = postOrder.slice(0, reachableCount).reverse();
  const unreachable = postOrder.slice(reachableCount).reverse();
  return [...reachable, ...unreachable];
};

// ../analysis/dataflow/indexed-map.ts
var VH = Symbol("vh");
var _f64 = new Float64Array(1);
var _u32 = new Uint32Array(_f64.buffer);
var computeValueHash = (val) => {
  switch (val.kind) {
    case "bottom":
      return 65536;
    case "top":
      return 131072;
    case "input":
      return 196608;
    case "loop":
      return 262144;
    case "constant": {
      const v = val.value;
      if (typeof v === "boolean") return v ? 327681 : 327680;
      if (typeof v === "number") {
        if (v === (v | 0)) return fnvMixInt(393216, v | 0);
        _f64[0] = v;
        return fnvMixInt(fnvMixInt(393216, _u32[0]), _u32[1]);
      }
      return fnvMixStr(458752, v);
    }
    case "range": {
      _f64[0] = val.min;
      const h = fnvMixInt(fnvMixInt(524288, _u32[0]), _u32[1]);
      _f64[0] = val.max;
      return fnvMixInt(fnvMixInt(h, _u32[0]), _u32[1]);
    }
    case "set": {
      let h = fnvMixInt(589824, val.hasUserInput ? 1 : 0);
      for (const v of val.values) {
        if (typeof v === "number") {
          if (v === (v | 0)) {
            h = fnvMixInt(h, v | 0);
          } else {
            _f64[0] = v;
            h = fnvMixInt(fnvMixInt(h, _u32[0]), _u32[1]);
          }
        } else if (typeof v === "boolean") {
          h = fnvMixInt(h, v ? 1 : 0);
        } else {
          h = fnvMixStr(h, v);
        }
      }
      return h;
    }
  }
  return 0;
};
var valueHash = (val) => {
  let vh = val[VH];
  if (vh !== void 0) return vh;
  vh = computeValueHash(val);
  val[VH] = vh;
  return vh;
};
var contrib = (nameHash, val) => fnvMixInt(nameHash, valueHash(val));
var SceneView = class {
  _owner;
  scene;
  _indices;
  constructor(owner, scene) {
    this._owner = owner;
    this.scene = scene;
    this._indices = /* @__PURE__ */ new Map();
  }
  get size() {
    return this._indices.size;
  }
  get(key) {
    const idx = this._indices.get(key);
    return idx !== void 0 ? this._owner.values[idx] : void 0;
  }
  set(key, value) {
    let idx = this._indices.get(key);
    if (idx !== void 0) {
      this._owner._setAt(idx, value);
    } else {
      idx = this._owner._addEntry(this.scene, key, value);
      this._indices.set(key, idx);
    }
    return this;
  }
  has(key) {
    const idx = this._indices.get(key);
    if (idx === void 0) return false;
    return this._owner.values[idx].kind !== "bottom";
  }
  clear() {
    for (const [, idx] of this._indices) {
      this._owner._setAt(idx, bottom);
    }
  }
  *[Symbol.iterator]() {
    for (const [name, idx] of this._indices) {
      const v = this._owner.values[idx];
      if (v.kind !== "bottom") yield [name, v];
    }
  }
  forEach(fn) {
    for (const [name, idx] of this._indices) {
      const v = this._owner.values[idx];
      if (v.kind !== "bottom") fn(v, name);
    }
  }
};
var IndexedTempMap = class {
  _scenes = /* @__PURE__ */ new Map();
  _nameHashes;
  values;
  _shared = false;
  _xorHash;
  _size;
  constructor() {
    this._nameHashes = [];
    this.values = [];
    this._xorHash = 0;
    this._size = 0;
  }
  get xorHash() {
    return this._xorHash;
  }
  get size() {
    return this._scenes.size;
  }
  isAllTop() {
    for (let i = 0; i < this._size; i++) {
      if (this.values[i].kind !== "top") return false;
    }
    return true;
  }
  ensureOwned() {
    if (this._shared) {
      this.values = this.values.slice();
      this._shared = false;
    }
  }
  _setAt(idx, value) {
    const old = this.values[idx];
    if (old !== value) {
      this.ensureOwned();
      this._xorHash ^= contrib(this._nameHashes[idx], old) ^ contrib(this._nameHashes[idx], value);
      this.values[idx] = value;
    }
  }
  _addEntry(scene, name, value) {
    this.ensureOwned();
    const idx = this._size++;
    if (idx < this.values.length) {
      this._xorHash ^= contrib(this._nameHashes[idx], this.values[idx]) ^ contrib(this._nameHashes[idx], value);
      this.values[idx] = value;
    } else {
      const nh = fnvMixStr(fnvMixStr(FNV_OFFSET, scene), name);
      this._nameHashes.push(nh);
      this._xorHash ^= contrib(nh, value);
      this.values.push(value);
    }
    return idx;
  }
  addScene(scene) {
    let sv = this._scenes.get(scene);
    if (!sv) {
      sv = new SceneView(this, scene);
      this._scenes.set(scene, sv);
    }
    return sv;
  }
  get(scene) {
    return this._scenes.get(scene);
  }
  has(scene) {
    return this._scenes.has(scene);
  }
  set(scene, vars) {
    let sv = this._scenes.get(scene);
    if (!sv) {
      sv = new SceneView(this, scene);
      this._scenes.set(scene, sv);
    }
    for (const [k, v] of vars) sv.set(k, v);
    return this;
  }
  shareValues() {
    this._shared = true;
    return this.values;
  }
  adoptValues(src, hash) {
    if (src.length < this._size) {
      src = src.slice();
      while (src.length < this._size) src.push(bottom);
      this.values = src;
      this._shared = false;
      this.recomputeXorHash();
    } else {
      this.values = src;
      this._shared = true;
      this._xorHash = hash;
    }
  }
  takeValues(src) {
    while (src.length < this._size) src.push(bottom);
    this.values = src;
    this._shared = false;
    this.recomputeXorHash();
  }
  cloneValues() {
    return this.values.slice(0, this._size);
  }
  joinValues(src) {
    const len = Math.min(src.length, this._size);
    const nh = this._nameHashes;
    for (let i = 0; i < len; i++) {
      if (this.values[i] !== src[i]) {
        const old = this.values[i];
        const joined = join(old, src[i]);
        if (joined !== old) {
          this.ensureOwned();
          this._xorHash ^= contrib(nh[i], old) ^ contrib(nh[i], joined);
          this.values[i] = joined;
        }
      }
    }
  }
  recomputeXorHash() {
    let h = 0;
    const nh = this._nameHashes;
    const sz = this._size;
    for (let i = 0; i < sz; i++) {
      h ^= contrib(nh[i], this.values[i]);
    }
    this._xorHash = h;
  }
  *[Symbol.iterator]() {
    yield* this._scenes;
  }
  /** Restore all values to bottom (for full restoreTemps) */
  clearAllValues() {
    this.ensureOwned();
    this.values.fill(bottom, 0, this._size);
    this._xorHash = 0;
    const bh = valueHash(bottom);
    const nh = this._nameHashes;
    for (let i = 0; i < this._size; i++) {
      this._xorHash ^= contrib(nh[i], bottom);
    }
  }
};
var IndexedMap = class _IndexedMap {
  index;
  names;
  values;
  _shared = false;
  _nameHashes;
  _xorHash;
  constructor(index, names, values) {
    this.index = index;
    this.names = names;
    this.values = values ?? new Array(index.size).fill(bottom);
    this._nameHashes = new Array(names.length);
    this._xorHash = 0;
    for (let i = 0; i < names.length; i++) {
      this._nameHashes[i] = fnvMixStr(FNV_OFFSET, names[i]);
      this._xorHash ^= contrib(this._nameHashes[i], this.values[i]);
    }
  }
  get xorHash() {
    return this._xorHash;
  }
  ensureOwned() {
    if (this._shared) {
      this.values = this.values.slice();
      this._shared = false;
    }
  }
  recomputeXorHash() {
    let h = 0;
    const nh = this._nameHashes;
    const vals = this.values;
    const len = this.names.length;
    for (let i = 0; i < len; i++) {
      h ^= contrib(nh[i], vals[i] ?? bottom);
    }
    this._xorHash = h;
  }
  get size() {
    return this.names.length;
  }
  get(key) {
    const idx = this.index.get(key);
    return idx !== void 0 ? this.values[idx] : void 0;
  }
  set(key, value) {
    let idx = this.index.get(key);
    if (idx !== void 0) {
      const old = this.values[idx];
      if (old !== value) {
        this.ensureOwned();
        this._xorHash ^= contrib(this._nameHashes[idx], old) ^ contrib(this._nameHashes[idx], value);
        this.values[idx] = value;
      }
    } else {
      this.ensureOwned();
      idx = this.names.length;
      this.index.set(key, idx);
      this.names.push(key);
      const nh = fnvMixStr(FNV_OFFSET, key);
      this._nameHashes.push(nh);
      this._xorHash ^= contrib(nh, value);
      this.values.push(value);
    }
    return this;
  }
  has(key) {
    return this.index.has(key);
  }
  isAllTop() {
    for (let i = 0; i < this.values.length; i++) {
      if (this.values[i].kind !== "top") return false;
    }
    return true;
  }
  clear() {
    this.ensureOwned();
    this.values.fill(bottom);
    this.recomputeXorHash();
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.names.length; i++) {
      yield [this.names[i], this.values[i]];
    }
  }
  entries() {
    return this[Symbol.iterator]();
  }
  forEach(fn) {
    for (let i = 0; i < this.names.length; i++) {
      fn(this.values[i], this.names[i]);
    }
  }
  cloneValues() {
    const len = this.names.length;
    const result = this.values.slice(0, len);
    while (result.length < len) result.push(bottom);
    return result;
  }
  clone() {
    return new _IndexedMap(this.index, this.names, this.values.slice());
  }
  shareValues() {
    this._shared = true;
    return this.values;
  }
  adoptValues(src, hash) {
    const len = this.names.length;
    if (src.length < len) {
      src = src.slice();
      while (src.length < len) src.push(bottom);
      this.values = src;
      this._shared = false;
      this.recomputeXorHash();
    } else {
      this.values = src;
      this._shared = true;
      if (hash !== void 0) this._xorHash = hash;
      else this.recomputeXorHash();
    }
  }
  takeValues(src) {
    const len = this.names.length;
    while (src.length < len) src.push(bottom);
    this.values = src;
    this._shared = false;
    this.recomputeXorHash();
  }
  joinValues(src) {
    if (src === this.values) return;
    const len = Math.min(src.length, this.values.length);
    const nh = this._nameHashes;
    for (let i = 0; i < len; i++) {
      const old = this.values[i];
      const srcVal = src[i];
      if (old === srcVal || old.kind === "top") continue;
      const joined = join(old, srcVal);
      if (joined !== old) {
        this.ensureOwned();
        this._xorHash ^= contrib(nh[i], old) ^ contrib(nh[i], joined);
        this.values[i] = joined;
      }
    }
  }
};

// ../analysis/ref-cfg/dominators.ts
var buildDominatorTree = (entryBlockId, blocks, edges) => {
  const blockIds = Object.keys(blocks);
  const succs = /* @__PURE__ */ new Map();
  const preds = /* @__PURE__ */ new Map();
  for (const id of blockIds) {
    succs.set(id, []);
    preds.set(id, []);
  }
  for (const edge of edges) {
    if (!edge.targetBlockId || !blocks[edge.targetBlockId]) continue;
    succs.get(edge.sourceBlockId).push(edge.targetBlockId);
    preds.get(edge.targetBlockId).push(edge.sourceBlockId);
  }
  const rpo = reversePostOrder(entryBlockId, succs, blockIds);
  const idom = computeDominators2(entryBlockId, rpo, preds);
  const children = buildChildren(idom);
  const exitBlocks = findExitBlocks(blockIds, succs);
  const ipdom = computePostDominators(exitBlocks, preds, succs, blockIds);
  const pdomChildren = buildChildren(ipdom);
  return { idom, ipdom, children, pdomChildren };
};
var reversePostOrder = (entry, adj, allNodes) => {
  const visited = /* @__PURE__ */ new Set();
  const order = [];
  const stack = [];
  stack.push({ id: entry, childIndex: 0 });
  visited.add(entry);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const neighbours = adj.get(frame.id) ?? [];
    if (frame.childIndex < neighbours.length) {
      const child = neighbours[frame.childIndex++];
      if (!visited.has(child)) {
        visited.add(child);
        stack.push({ id: child, childIndex: 0 });
      }
    } else {
      order.push(frame.id);
      stack.pop();
    }
  }
  for (const id of allNodes) {
    if (!visited.has(id)) order.push(id);
  }
  order.reverse();
  return order;
};
var computeDominators2 = (entry, rpo, preds) => {
  const rpoIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < rpo.length; i++) rpoIndex.set(rpo[i], i);
  const idom = /* @__PURE__ */ new Map();
  idom.set(entry, null);
  const intersect2 = (a, b) => {
    let fingerA = a;
    let fingerB = b;
    while (fingerA !== fingerB) {
      while (rpoIndex.get(fingerA) > rpoIndex.get(fingerB)) {
        fingerA = idom.get(fingerA);
      }
      while (rpoIndex.get(fingerB) > rpoIndex.get(fingerA)) {
        fingerB = idom.get(fingerB);
      }
    }
    return fingerA;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo) {
      if (b === entry) continue;
      const predecessors = preds.get(b) ?? [];
      let newIdom;
      for (const p of predecessors) {
        if (!idom.has(p)) continue;
        if (newIdom === void 0) {
          newIdom = p;
        } else {
          newIdom = intersect2(newIdom, p);
        }
      }
      if (newIdom !== void 0 && idom.get(b) !== newIdom) {
        idom.set(b, newIdom);
        changed = true;
      }
    }
  }
  return idom;
};
var computePostDominators = (exitBlocks, fwdPreds, fwdSuccs, allBlocks) => {
  if (exitBlocks.length === 0) {
    const map = /* @__PURE__ */ new Map();
    for (const id of allBlocks) map.set(id, null);
    return map;
  }
  if (exitBlocks.length === 1) {
    const rpo2 = reversePostOrder(exitBlocks[0], fwdPreds, allBlocks);
    return computeDominators2(exitBlocks[0], rpo2, fwdSuccs);
  }
  const virtualExit = "__virtual_exit__";
  const revAdj = /* @__PURE__ */ new Map();
  for (const id of allBlocks) revAdj.set(id, [...fwdPreds.get(id) ?? []]);
  revAdj.set(virtualExit, [...exitBlocks]);
  for (const exit of exitBlocks) {
    revAdj.get(exit).push(virtualExit);
  }
  const revPreds = /* @__PURE__ */ new Map();
  for (const id of allBlocks) revPreds.set(id, [...fwdSuccs.get(id) ?? []]);
  revPreds.set(virtualExit, []);
  for (const exit of exitBlocks) {
    revPreds.get(virtualExit).push(exit);
  }
  const allWithVirtual = [...allBlocks, virtualExit];
  const rpo = reversePostOrder(virtualExit, revAdj, allWithVirtual);
  const idom = computeDominators2(virtualExit, rpo, revPreds);
  idom.delete(virtualExit);
  for (const [k, v] of idom) {
    if (v === virtualExit) idom.set(k, null);
  }
  return idom;
};
var findExitBlocks = (blockIds, succs) => {
  const exits = [];
  for (const id of blockIds) {
    const s = succs.get(id);
    if (!s || s.length === 0) exits.push(id);
  }
  return exits;
};
var buildChildren = (idom) => {
  const children = /* @__PURE__ */ new Map();
  for (const [node, parent] of idom) {
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(node);
    else children.set(parent, [node]);
  }
  return children;
};
var getMergePoint = (branchBlockId, ipdom) => ipdom.get(branchBlockId) ?? null;

// ../analysis/ref-cfg/dominator-walk.ts
var buildCfgLayout = (cfg) => {
  const succs = /* @__PURE__ */ new Map();
  for (const id of Object.keys(cfg.blocks)) succs.set(id, []);
  for (const edge of cfg.edges) {
    if (!edge.targetBlockId || !cfg.blocks[edge.targetBlockId]) continue;
    succs.get(edge.sourceBlockId).push(edge);
  }
  const domTree = buildDominatorTree(cfg.entryBlockId, cfg.blocks, cfg.edges);
  const plan = [];
  let slotCounter = 0;
  const stack = [];
  const pushBlock = (bid) => {
    const edges = succs.get(bid) ?? [];
    const isBranch = edges.length > 1;
    const mergeBlockId = isBranch ? getMergePoint(bid, domTree.ipdom) : null;
    const domChildren = domTree.children.get(bid) ?? [];
    let armGroups = [];
    let nonBranchChildren = [];
    if (isBranch && mergeBlockId) {
      const armEntries = /* @__PURE__ */ new Map();
      for (let i = 0; i < edges.length; i++) {
        if (edges[i].targetBlockId && edges[i].targetBlockId !== mergeBlockId) {
          armEntries.set(edges[i].targetBlockId, i);
        }
      }
      armGroups = edges.map(() => []);
      for (const child of domChildren) {
        if (child === mergeBlockId) continue;
        const armIdx = armEntries.get(child);
        if (armIdx !== void 0) {
          armGroups[armIdx].push(child);
        } else {
          let assigned = false;
          for (const [entry, idx] of armEntries) {
            if (isDominatedBy(child, entry, domTree.idom)) {
              armGroups[idx].push(child);
              assigned = true;
              break;
            }
          }
          if (!assigned) nonBranchChildren.push(child);
        }
      }
    } else {
      nonBranchChildren = domChildren;
    }
    stack.push({
      blockId: bid,
      phase: 0,
      edges,
      mergeBlockId,
      slot: isBranch && mergeBlockId ? slotCounter++ : 0,
      domChildren,
      armGroups,
      nonBranchChildren
    });
  };
  pushBlock(cfg.entryBlockId);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.phase === 0) {
      plan.push({ kind: "block", blockId: frame.blockId });
      if (frame.armGroups.length > 0 && frame.mergeBlockId) {
        frame.phase = 1;
        const firstEdge = frame.edges[0];
        plan.push({ kind: "branch-start", edge: firstEdge, slot: frame.slot });
        const arm = frame.armGroups[0];
        for (let i = arm.length - 1; i >= 0; i--) pushBlock(arm[i]);
      } else {
        frame.phase = -1;
        for (let i = frame.nonBranchChildren.length - 1; i >= 0; i--) {
          pushBlock(frame.nonBranchChildren[i]);
        }
      }
      continue;
    }
    if (frame.phase > 0 && frame.phase < frame.armGroups.length) {
      const armIdx = frame.phase;
      const edge = frame.edges[armIdx] ?? frame.edges[0];
      plan.push({ kind: "arm-boundary", edge, slot: frame.slot });
      frame.phase = armIdx + 1;
      const arm = frame.armGroups[armIdx];
      for (let i = arm.length - 1; i >= 0; i--) pushBlock(arm[i]);
      continue;
    }
    if (frame.phase >= frame.armGroups.length && frame.armGroups.length > 0 && frame.mergeBlockId) {
      plan.push({ kind: "branch-end", slot: frame.slot });
      frame.phase = -1;
      if (frame.domChildren.includes(frame.mergeBlockId)) {
        pushBlock(frame.mergeBlockId);
      }
      continue;
    }
    stack.pop();
  }
  return { walkPlan: plan, maxSlots: slotCounter };
};
var isDominatedBy = (block, dominator, idom) => {
  let current = block;
  while (current !== null && current !== void 0) {
    if (current === dominator) return true;
    current = idom.get(current) ?? null;
  }
  return false;
};
var applyStatementEffect = (stmt, state, scene) => {
  if (stmt.kind === "Parameters") {
    const params = stmt;
    for (const id of params.identifiers) {
      const existing = getVariable(state, id.value, scene);
      if (existing.kind === "bottom") {
        setVariableMut(state, id.value, top, "Temporary", scene);
      }
    }
    return;
  }
  const effect = extractEffect(stmt);
  if (!effect.defines) return;
  const { variable, scope, valueExpression, isCompoundAssignment, compoundExpression } = effect.defines;
  let value;
  if (stmt.kind === "InputText" || stmt.kind === "InputNumber") {
    value = input;
  } else if (stmt.kind === "GenerateRandom") {
    const s = stmt;
    const minVal = evaluateExpression(s.min, state, scene);
    const maxVal = evaluateExpression(s.max, state, scene);
    if (minVal.kind === "constant" && typeof minVal.value === "number" && maxVal.kind === "constant" && typeof maxVal.value === "number") {
      value = { kind: "range", min: minVal.value, max: maxVal.value };
    } else {
      value = top;
    }
  } else if (isCompoundAssignment && compoundExpression) {
    value = evaluateExpression(compoundExpression, state, scene);
  } else if (valueExpression) {
    value = evaluateExpression(valueExpression, state, scene);
  } else {
    value = scope === "Global" ? { kind: "constant", value: false } : { kind: "constant", value: "" };
  }
  if (scope === "Temporary") {
    setVariableMut(state, variable, value, "Temporary", scene);
  } else if (hasGlobal(state, variable) || isTempVariable(state, variable, scene)) {
    updateVariableMut(state, variable, value, scene);
  } else {
    setVariableMut(state, variable, value, "Global", scene);
  }
};
var applyBlockStatements = (blockId, state, scene, blockIndex, statements) => {
  const block = blockIndex[blockId];
  if (!block) return;
  for (const stmtId of block.statementIds) {
    const stmt = statements[stmtId];
    if (stmt) applyStatementEffect(stmt, state, scene);
  }
};
var walkCfgBlocks = (layout, state, scene, blockIndex, statements, onBlock) => {
  const plan = layout.walkPlan;
  if (plan.length === 0) return;
  const globals = state.globals;
  const temps = state.temps;
  const savedGlobals = new Array(layout.maxSlots);
  const savedGlobalHashes = new Array(layout.maxSlots);
  const savedTemps = new Array(layout.maxSlots);
  const savedTempHashes = new Array(layout.maxSlots);
  const joinedGlobals = new Array(layout.maxSlots);
  const joinedTemps = new Array(layout.maxSlots);
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    switch (item.kind) {
      case "block":
        onBlock?.(item.blockId);
        applyBlockStatements(item.blockId, state, scene, blockIndex, statements);
        break;
      case "branch-start":
        savedGlobalHashes[item.slot] = globals.xorHash;
        savedGlobals[item.slot] = globals.shareValues();
        savedTempHashes[item.slot] = temps.xorHash;
        savedTemps[item.slot] = temps.shareValues();
        joinedGlobals[item.slot] = null;
        joinedTemps[item.slot] = null;
        break;
      case "arm-boundary": {
        const slot = item.slot;
        if (joinedGlobals[slot] === null) {
          joinedGlobals[slot] = globals.cloneValues();
          joinedTemps[slot] = temps.cloneValues();
        } else {
          const jg = joinedGlobals[slot];
          const gv = globals.values;
          for (let j = 0; j < jg.length; j++) {
            if (jg[j] !== gv[j]) jg[j] = join(jg[j], gv[j]);
          }
          const jt = joinedTemps[slot];
          const tv = temps.values;
          for (let j = 0; j < jt.length; j++) {
            if (jt[j] !== tv[j]) jt[j] = join(jt[j], tv[j]);
          }
        }
        globals.adoptValues(savedGlobals[slot], savedGlobalHashes[slot]);
        temps.adoptValues(savedTemps[slot], savedTempHashes[slot]);
        break;
      }
      case "branch-end": {
        const slot = item.slot;
        if (joinedGlobals[slot] === null) {
          joinedGlobals[slot] = globals.cloneValues();
          joinedTemps[slot] = temps.cloneValues();
        } else {
          const jg = joinedGlobals[slot];
          const gv = globals.values;
          for (let j = 0; j < jg.length; j++) {
            if (jg[j] !== gv[j]) jg[j] = join(jg[j], gv[j]);
          }
          const jt = joinedTemps[slot];
          const tv = temps.values;
          for (let j = 0; j < jt.length; j++) {
            if (jt[j] !== tv[j]) jt[j] = join(jt[j], tv[j]);
          }
        }
        globals.takeValues(joinedGlobals[slot]);
        temps.takeValues(joinedTemps[slot]);
        savedGlobals[slot] = null;
        savedTemps[slot] = null;
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        break;
      }
    }
  }
};

// ../analysis/ref-cfg/extract-symbols.ts
var extractSymbols = (linked, cfgOrder, blockIndex, statements) => {
  const sites = [];
  for (let cfgIdx = 0; cfgIdx < cfgOrder.length; cfgIdx++) {
    const cfgId = cfgOrder[cfgIdx];
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    const blockOrder = topologicalBlockOrder(cfg.blocks, cfg.edges);
    for (const blockId of blockOrder) {
      const block = blockIndex[blockId];
      if (!block) continue;
      for (const stmtId of block.statementIds) {
        const stmt = statements[stmtId];
        if (!stmt) continue;
        collectStatementSites(stmt, stmtId, cfgId, cfg.scene, cfgIdx, sites);
      }
    }
  }
  const variables = buildSummaries(sites);
  return { sites, variables };
};
var collectStatementSites = (stmt, stmtId, cfgId, scene, cfgOrder, sites) => {
  const base = { statementId: stmtId, statementKind: stmt.kind, cfgId, scene, cfgOrder };
  if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
    const name = stmt.variable?.value;
    if (name) {
      sites.push({ ...base, variable: name, kind: "delete", scope: "Global" });
    }
    return;
  }
  const effect = extractEffect(stmt);
  if (effect.defines) {
    sites.push({
      ...base,
      variable: effect.defines.variable,
      kind: "def",
      scope: effect.defines.scope
    });
  }
  if (stmt.kind === "DeclareArray") {
    const arr = stmt;
    if (arr.declarations) {
      for (const decl of arr.declarations) {
        const sub = extractEffect(decl);
        if (sub.defines) {
          sites.push({
            ...base,
            variable: sub.defines.variable,
            kind: "def",
            scope: sub.defines.scope
          });
        }
      }
    }
  }
  if (stmt.kind === "Parameters") {
    const params = stmt;
    for (const id of params.identifiers) {
      sites.push({ ...base, variable: id.value, kind: "def", scope: "Temporary" });
    }
  }
  const refs = collectRefsFromStatement(stmt);
  const defVar = effect.defines?.variable;
  for (const ref of refs) {
    if (ref === defVar) continue;
    sites.push({ ...base, variable: ref, kind: "ref", scope: "Global" });
  }
};
var buildSummaries = (sites) => {
  const map = /* @__PURE__ */ new Map();
  for (const site of sites) {
    let summary = map.get(site.variable);
    if (!summary) {
      summary = {
        variable: site.variable,
        scope: site.scope,
        firstDef: null,
        firstRef: null,
        deleted: false,
        defCount: 0,
        refCount: 0
      };
      map.set(site.variable, summary);
    }
    switch (site.kind) {
      case "def":
        summary.defCount++;
        if (summary.scope === "Global" && site.scope === "Global") summary.scope = site.scope;
        if (site.statementKind === "Parameters") summary.isParam = true;
        if (!summary.firstDef) summary.firstDef = site;
        break;
      case "ref":
        summary.refCount++;
        if (!summary.firstRef) summary.firstRef = site;
        break;
      case "delete":
        summary.deleted = true;
        break;
    }
  }
  return map;
};

// ../analysis/ref-cfg/narrow-guard.ts
var narrowStateByGuard = (guard, state, scene, statements) => {
  const stmtId = guard.metadata.conditionStatementId ?? guard.metadata.choiceConditionId;
  if (!stmtId) return null;
  const stmt = statements[stmtId];
  if (!stmt) return null;
  let expr;
  if (guard.edgeKind === "ElseBranch") {
    expr = stmt.invertedCondition;
  } else if (guard.edgeKind === "ElseIfBranch") {
    expr = stmt.effectiveCondition ?? stmt.expression;
  } else if (guard.edgeKind === "IfFallThrough") {
    const base = stmt.expression;
    expr = base ? invertExpression(base) : null;
  } else {
    expr = stmt.expression ?? stmt.selectableIf;
  }
  if (!expr) return null;
  return narrowStateByExpression(expr, state, scene);
};
var narrowStateByGuardNegation = (guard, state, scene, statements) => {
  const stmtId = guard.metadata.conditionStatementId ?? guard.metadata.choiceConditionId;
  if (!stmtId) return null;
  const stmt = statements[stmtId];
  if (!stmt) return null;
  let expr;
  if (guard.edgeKind === "IfBranch") {
    const base = stmt.expression;
    expr = base ? invertExpression(base) : null;
  } else if (guard.edgeKind === "ElseIfBranch") {
    const base = stmt.effectiveCondition ?? stmt.expression;
    expr = base ? invertExpression(base) : null;
  } else {
    return null;
  }
  if (!expr) return null;
  return narrowStateByExpression(expr, state, scene);
};
var narrowStateByExpression = (expr, state, scene) => {
  if (expr.left && expr.operator && expr.right && expr.operator.type === "LogicalAnd") {
    let current = state;
    let changed = false;
    const leftResult = narrowStateByExpression(expr.left, current, scene);
    if (leftResult) {
      current = leftResult;
      changed = true;
    }
    const rightResult = narrowStateByExpression(expr.right, current, scene);
    if (rightResult) {
      current = rightResult;
      changed = true;
    }
    return changed ? current : null;
  }
  if (!expr.left || !expr.operator || !expr.right) return null;
  const constraint = decomposeComparison(expr, state, scene);
  if (!constraint) return null;
  const { varName, varValue, threshold, op } = constraint;
  const narrowed = narrowAbstractByOp(varValue, threshold, op);
  if (!narrowed || narrowed === varValue) return null;
  const result = cloneState(state);
  const scope = isTempVariable(state, varName, scene) ? "Temporary" : "Global";
  setVariableMut(result, varName, narrowed, scope, scene);
  return result;
};
var decomposeComparison = (expr, state, scene) => {
  const opMap = {
    GreaterThanOperator: ">",
    GreaterThanEqualsOperator: ">=",
    LessThanOperator: "<",
    LessThanEqualsOperator: "<=",
    EqualityOperator: "=",
    NotEqualityOperator: "!="
  };
  const op = opMap[expr.operator?.type];
  if (!op) return null;
  const leftVar = soleIdentifierName(expr.left);
  const rightVar = soleIdentifierName(expr.right);
  if (leftVar !== null) {
    const rightVal = evaluateExpression(expr.right, state, scene);
    if (rightVal.kind === "constant" && typeof rightVal.value === "number") {
      return { varName: leftVar, varValue: getVariable(state, leftVar, scene), threshold: rightVal.value, op };
    }
  }
  if (rightVar !== null) {
    const leftVal = evaluateExpression(expr.left, state, scene);
    if (leftVal.kind === "constant" && typeof leftVal.value === "number") {
      const flipped = {
        ">": "<",
        ">=": "<=",
        "<": ">",
        "<=": ">=",
        "=": "=",
        "!=": "!="
      };
      return { varName: rightVar, varValue: getVariable(state, rightVar, scene), threshold: leftVal.value, op: flipped[op] };
    }
  }
  return null;
};
var soleIdentifierName = (expr) => {
  if (!expr) return null;
  if (expr.token?.type === "Identifier") return expr.token.value;
  if (expr.expression && !expr.left && !expr.right) return soleIdentifierName(expr.expression);
  return null;
};
var narrowAbstractByOp = (value, threshold, op) => {
  switch (op) {
    case "=":
      return narrowToValue(value, threshold);
    case "!=":
      if (value.kind === "constant" && value.value === threshold) return top;
      if (value.kind === "set") {
        const filtered = value.values.filter((v) => v !== threshold);
        if (filtered.length === 0) return value.hasUserInput ? { kind: "input" } : top;
        return set(filtered, value.hasUserInput);
      }
      return null;
    case ">":
      return narrowNumeric(value, threshold + 1, Infinity);
    case ">=":
      return narrowNumeric(value, threshold, Infinity);
    case "<":
      return narrowNumeric(value, -Infinity, threshold - 1);
    case "<=":
      return narrowNumeric(value, -Infinity, threshold);
  }
};
var constraintFallback = (min, max) => {
  if (min === max) return { kind: "constant", value: min };
  return { kind: "range", min, max };
};
var narrowNumeric = (value, min, max) => {
  const fallback = constraintFallback(min, max);
  if (value.kind === "constant") {
    if (typeof value.value !== "number") return null;
    return value.value >= min && value.value <= max ? value : fallback;
  }
  if (value.kind === "set") {
    const filtered = value.values.filter((v) => typeof v === "number" && v >= min && v <= max);
    if (filtered.length === 0) return value.hasUserInput ? { kind: "input" } : fallback;
    return set(filtered, value.hasUserInput);
  }
  if (value.kind === "range") {
    const newMin = Math.max(value.min, min);
    const newMax = Math.min(value.max, max === Infinity ? value.max : max);
    if (newMin > newMax) return fallback;
    if (newMin === newMax) return { kind: "constant", value: newMin };
    return { kind: "range", min: newMin, max: newMax };
  }
  return null;
};

// ../analysis/ref-cfg/location-index.ts
var LocationIndex = class {
  bySceneLine = /* @__PURE__ */ new Map();
  stmtToEntry = /* @__PURE__ */ new Map();
  statements;
  blockToCfg;
  dataflowByCfg = /* @__PURE__ */ new Map();
  stateStore = /* @__PURE__ */ new Map();
  cfgEntryStates = /* @__PURE__ */ new Map();
  reachableCfgs = /* @__PURE__ */ new Set();
  deadBranches = [];
  controlFlowViolations = [];
  undeclaredSets = [];
  multiReplaceViolations = [];
  unreachableCode = [];
  variableDefs = /* @__PURE__ */ new Map();
  variableRefs = /* @__PURE__ */ new Map();
  variableDeletes = /* @__PURE__ */ new Map();
  blockEntryStates = new MultiMap();
  transfers = null;
  blockIndex = {};
  segmentEntryStates = /* @__PURE__ */ new Map();
  blockDeltaMap = /* @__PURE__ */ new Map();
  blockToSegmentMap = /* @__PURE__ */ new Map();
  identifiers = /* @__PURE__ */ new Map();
  sceneSymbols = /* @__PURE__ */ new Map();
  globalDeclarations = /* @__PURE__ */ new Map();
  _gosubTargets = null;
  stmtRefToId = /* @__PURE__ */ new Map();
  constructor(blockIndex, statements, blockToCfg) {
    this.statements = statements;
    this.blockToCfg = blockToCfg;
    this.blockIndex = blockIndex;
    const stmtToBlock = /* @__PURE__ */ new Map();
    for (const [blockId, block] of Object.entries(blockIndex)) {
      for (const sid of block.statementIds) {
        stmtToBlock.set(sid, blockId);
      }
    }
    for (const [stmtId, stmt] of Object.entries(statements)) {
      this.stmtRefToId.set(stmt, stmtId);
      const token = stmt.token ?? stmt.content?.[0];
      if (!token) continue;
      const blockId = stmtToBlock.get(stmtId);
      if (!blockId) continue;
      const cfgId = this.blockToCfg.get(blockId);
      if (!cfgId) continue;
      const entry = {
        scene: token.sceneName,
        line: token.lineNumber,
        position: token.position ?? 0,
        statementId: stmtId,
        statementKind: stmt.kind,
        cfgId,
        blockId
      };
      this.stmtToEntry.set(stmtId, entry);
      const key = `${token.sceneName}:${token.lineNumber}`;
      const existing = this.bySceneLine.get(key);
      if (existing) existing.push(entry);
      else this.bySceneLine.set(key, [entry]);
      this.indexVariable(stmt, stmtId, entry);
      this.indexSymbol(stmt, token.sceneName);
    }
  }
  attachDataflow(dataflowStates, stateStore) {
    this.stateStore = stateStore;
    for (const state of dataflowStates) {
      this.dataflowByCfg.set(state.cfgId, state);
    }
  }
  attachCfgEntryStates(states) {
    this.cfgEntryStates = states;
  }
  attachBlockStates(blockStates) {
    for (const bs of blockStates) {
      this.blockEntryStates.add(bs.blockId, { state: bs.state, scene: bs.scene, provenance: bs.provenance });
    }
  }
  attachSegmentDeltas(segmentStates, blockDeltas, blockToSegment) {
    for (const [segId, states] of segmentStates) {
      this.segmentEntryStates.set(segId, states.entry);
    }
    this.blockDeltaMap = blockDeltas;
    this.blockToSegmentMap = blockToSegment;
  }
  attachTransfers(transfers) {
    this.transfers = transfers;
  }
  resolveBlockEntryFromSegment(blockId) {
    const segId = this.blockToSegmentMap.get(blockId);
    if (!segId) return null;
    const segEntry = this.segmentEntryStates.get(segId);
    if (!segEntry) return null;
    const delta = this.blockDeltaMap.get(blockId);
    if (!delta) return segEntry;
    const globals = { ...segEntry.globals, ...delta.globals };
    const temps = {};
    for (const [scene, vars] of Object.entries(segEntry.temps)) {
      temps[scene] = { ...vars };
    }
    for (const [scene, vars] of Object.entries(delta.temps)) {
      if (!temps[scene]) temps[scene] = {};
      Object.assign(temps[scene], vars);
    }
    return { globals, temps };
  }
  getStateAtStatement(statementId, scene) {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];
    const blockId = entry.blockId;
    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      return [serializeState(state)];
    }
    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];
    return entries.map((blockEntry) => {
      const block = this.blockIndex[blockId];
      if (!block) return serializeState(blockEntry.state);
      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      return serializeState(state);
    });
  }
  getStateBeforeAndAfter(statementId, scene) {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];
    const blockId = entry.blockId;
    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      const before = serializeState(state);
      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, scene);
      const after = serializeState(state);
      return [{ before, after }];
    }
    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];
    return entries.map((blockEntry) => {
      const block = this.blockIndex[blockId];
      if (!block) {
        const s = serializeState(blockEntry.state);
        return { before: s, after: s };
      }
      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      const before = serializeState(state);
      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, blockEntry.scene);
      const after = serializeState(state);
      return { before, after };
    });
  }
  getParamCallValues(cfgId, paramName) {
    const lowerParam = paramName.toLowerCase();
    let paramIndex = -1;
    for (const [stmtId, entry] of this.stmtToEntry) {
      if (entry.cfgId !== cfgId) continue;
      const stmt = this.statements[stmtId];
      if (stmt?.kind !== "Parameters") continue;
      const ids = stmt.identifiers;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i].value.toLowerCase() === lowerParam) {
          paramIndex = i;
          break;
        }
      }
      break;
    }
    if (paramIndex < 0) return [];
    const parts = cfgId.split(":");
    const targetScene = parts[0].toLowerCase();
    const targetLabel = (parts[1] ?? "").toLowerCase();
    const results = [];
    for (const [, ss] of this.sceneSymbols) {
      for (const gosubStmt of ss.gosubs) {
        const target = extractStaticLabelTarget(gosubStmt);
        if (!target) continue;
        if (target.scene !== targetScene || target.label !== targetLabel) continue;
        const gosub = gosubStmt;
        if (!gosub.args || gosub.args.length <= paramIndex) continue;
        const gosubStmtId = this.stmtRefToId.get(gosubStmt);
        if (!gosubStmtId) continue;
        const gosubEntry = this.stmtToEntry.get(gosubStmtId);
        if (!gosubEntry) continue;
        const entryStates = this.resolveEntryStates(gosubEntry.cfgId);
        if (!entryStates) continue;
        for (const serialized of entryStates) {
          const state = deserializeToVariableState(serialized);
          const value = evaluateExpression(gosub.args[paramIndex], state, gosubEntry.scene);
          results.push({ callerScene: gosubEntry.scene, callerLine: gosubEntry.line, value });
        }
      }
    }
    return results;
  }
  getCallSiteVariableValues(cfgId, variable) {
    const parts = cfgId.split(":");
    if (parts.length < 2 || !parts[1]) return [];
    const targetScene = parts[0].toLowerCase();
    const targetLabel = parts[1].toLowerCase();
    const lowerVar = variable.toLowerCase();
    const results = [];
    for (const [, ss] of this.sceneSymbols) {
      for (const gosubStmt of ss.gosubs) {
        const target = extractStaticLabelTarget(gosubStmt);
        if (!target) continue;
        if (target.scene !== targetScene || target.label !== targetLabel) continue;
        const gosubStmtId = this.stmtRefToId.get(gosubStmt);
        if (!gosubStmtId) continue;
        const gosubEntry = this.stmtToEntry.get(gosubStmtId);
        if (!gosubEntry) continue;
        const states = this.getStateAtStatement(gosubStmtId, gosubEntry.scene);
        for (const state of states) {
          const tempScene = state.temps[gosubEntry.scene];
          let value;
          if (tempScene && lowerVar in tempScene) {
            value = tempScene[lowerVar];
          } else if (lowerVar in state.globals) {
            value = state.globals[lowerVar];
          }
          if (value && value.kind !== "bottom") {
            results.push({ callerScene: gosubEntry.scene, callerLine: gosubEntry.line, value });
          }
        }
      }
    }
    return results;
  }
  getAttributedStatesAtStatement(statementId, scene) {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];
    const blockId = entry.blockId;
    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      return [{ state: serializeState(state) }];
    }
    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];
    return entries.map((blockEntry) => {
      const block = this.blockIndex[blockId];
      if (!block) return { provenance: blockEntry.provenance, state: serializeState(blockEntry.state) };
      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      return { provenance: blockEntry.provenance, state: serializeState(state) };
    });
  }
  getAttributedBeforeAndAfter(statementId, scene) {
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];
    const blockId = entry.blockId;
    const segState = this.resolveBlockEntryFromSegment(blockId);
    if (segState) {
      const state = deserializeToVariableState(segState);
      const block = this.blockIndex[blockId];
      if (block) {
        for (const stmtId of block.statementIds) {
          if (stmtId === statementId) break;
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      }
      const before = serializeState(state);
      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, scene);
      const after = serializeState(state);
      return [{ before, after }];
    }
    const entries = this.blockEntryStates.getAll(blockId);
    if (entries.length === 0) return [];
    return entries.map((blockEntry) => {
      const block = this.blockIndex[blockId];
      if (!block) {
        const s = serializeState(blockEntry.state);
        return { provenance: blockEntry.provenance, before: s, after: s };
      }
      const state = cloneState(blockEntry.state);
      for (const stmtId of block.statementIds) {
        if (stmtId === statementId) break;
        const stmt = this.statements[stmtId];
        if (stmt) applyEffect(stmt, state, blockEntry.scene);
      }
      const before = serializeState(state);
      const targetStmt = this.statements[statementId];
      if (targetStmt) applyEffect(targetStmt, state, blockEntry.scene);
      const after = serializeState(state);
      return { provenance: blockEntry.provenance, before, after };
    });
  }
  getCallSiteBeforeAndAfter(cfgId, statementId, scene) {
    if (!this.transfers) return [];
    const transfer = this.transfers.get(cfgId);
    if (!transfer) return [];
    const callerEntries = this.findGosubCallerEntries(cfgId);
    if (callerEntries.length === 0) return [];
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];
    const results = [];
    for (const caller of callerEntries) {
      const walked = this.walkTransferToStatement(caller.entryState, transfer, entry.blockId, statementId, scene);
      if (walked) {
        results.push({ callerScene: caller.scene, callerLine: caller.line, ...walked });
      }
    }
    return results;
  }
  getCallSiteStateAtStatement(cfgId, statementId, scene) {
    if (!this.transfers) return [];
    const transfer = this.transfers.get(cfgId);
    if (!transfer) return [];
    const callerEntries = this.findGosubCallerEntries(cfgId);
    if (callerEntries.length === 0) return [];
    const entry = this.stmtToEntry.get(statementId);
    if (!entry) return [];
    const results = [];
    for (const caller of callerEntries) {
      const walked = this.walkTransferToStatement(caller.entryState, transfer, entry.blockId, statementId, scene);
      if (walked) {
        results.push({ callerScene: caller.scene, callerLine: caller.line, state: walked.before });
      }
    }
    return results;
  }
  findGosubCallerEntries(cfgId) {
    const parts = cfgId.split(":");
    if (parts.length < 2 || !parts[1]) return [];
    const targetScene = parts[0].toLowerCase();
    const targetLabel = parts[1].toLowerCase();
    const results = [];
    for (const [, ss] of this.sceneSymbols) {
      for (const gosubStmt of ss.gosubs) {
        const target = extractStaticLabelTarget(gosubStmt);
        if (!target) continue;
        if (target.scene !== targetScene || target.label !== targetLabel) continue;
        const gosubStmtId = this.stmtRefToId.get(gosubStmt);
        if (!gosubStmtId) continue;
        const gosubEntry = this.stmtToEntry.get(gosubStmtId);
        if (!gosubEntry) continue;
        const states = this.getStateAtStatement(gosubStmtId, gosubEntry.scene);
        for (const state of states) {
          const deserialized = deserializeToVariableState(state);
          const gosub = gosubStmt;
          const entryBlock = this.findEntryBlockForCfg(cfgId);
          if (entryBlock?.parameterNames?.length && gosub.args?.length) {
            const count = Math.min(gosub.args.length, entryBlock.parameterNames.length);
            for (let i = 0; i < count; i++) {
              const argValue = evaluateExpression(gosub.args[i], deserialized, gosubEntry.scene);
              setVariableMut(deserialized, entryBlock.parameterNames[i], argValue, "Temporary", targetScene);
            }
          }
          results.push({ scene: gosubEntry.scene, line: gosubEntry.line, entryState: deserialized });
        }
      }
    }
    return results;
  }
  findEntryBlockForCfg(cfgId) {
    const transfer = this.transfers?.get(cfgId);
    if (transfer && transfer.effects.length > 0) {
      return this.blockIndex[transfer.effects[0].blockId] ?? null;
    }
    for (const [blockId, block] of Object.entries(this.blockIndex)) {
      if (this.blockToCfg.get(blockId) === cfgId && block.parameterNames?.length) return block;
    }
    return null;
  }
  walkTransferToStatement(entryState, transfer, targetBlockId, targetStmtId, scene) {
    let state = cloneState(entryState);
    for (const ge of transfer.effects) {
      const block = this.blockIndex[ge.blockId];
      if (!block) continue;
      if (ge.blockId === targetBlockId) {
        if (ge.guards.length > 0) {
          const lastGuard = ge.guards[ge.guards.length - 1];
          const narrowed = narrowStateByGuard(lastGuard, state, scene, this.statements);
          if (narrowed) state = narrowed;
        }
        for (const stmtId of block.statementIds) {
          if (stmtId === targetStmtId) {
            const before = serializeState(state);
            const targetStmt = this.statements[targetStmtId];
            if (targetStmt) applyEffect(targetStmt, state, scene);
            const after = serializeState(state);
            return { before, after };
          }
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
        return null;
      }
      if (ge.guards.length === 0) {
        for (const stmtId of block.statementIds) {
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, state, scene);
        }
      } else {
        const lastGuard = ge.guards[ge.guards.length - 1];
        const narrowed = narrowStateByGuard(lastGuard, state, scene, this.statements);
        const modified = cloneState(narrowed ?? state);
        for (const stmtId of block.statementIds) {
          const stmt = this.statements[stmtId];
          if (stmt) applyEffect(stmt, modified, scene);
        }
        const negNarrowed = narrowStateByGuardNegation(lastGuard, state, scene, this.statements);
        if (negNarrowed) state = negNarrowed;
        joinStatesMut(state, modified);
      }
    }
    return null;
  }
  attachReachability(reachable) {
    this.reachableCfgs = reachable;
  }
  attachDeadBranches(branches) {
    this.deadBranches = branches;
  }
  attachControlFlowViolations(violations) {
    this.controlFlowViolations = violations;
  }
  attachUndeclaredSets(violations) {
    this.undeclaredSets = violations;
  }
  attachMultiReplaceViolations(violations) {
    this.multiReplaceViolations = violations;
  }
  getMultiReplaceViolations() {
    return this.multiReplaceViolations;
  }
  attachUnreachableCode(items) {
    this.unreachableCode = items;
  }
  getUnreachableCode() {
    return this.unreachableCode;
  }
  getDeadBranches() {
    const results = [];
    for (const branch of this.deadBranches) {
      const entry = this.findFirstEntryForBlock(branch.blockId);
      if (!entry) continue;
      results.push({ scene: entry.scene, line: entry.line, reason: branch.reason });
    }
    return results;
  }
  getControlFlowViolations() {
    const results = [];
    for (const v of this.controlFlowViolations) {
      const entry = this.findLastEntryForBlock(v.blockId) ?? (v.displayBlockId ? this.findFirstEntryForBlock(v.displayBlockId) : null);
      if (!entry) continue;
      results.push({ scene: entry.scene, line: entry.line, kind: v.kind });
    }
    return results;
  }
  getUndeclaredSets() {
    const results = [];
    for (const v of this.undeclaredSets) {
      const line = v.line >= 0 ? v.line : this.stmtToEntry.get(v.statementId)?.line ?? -1;
      const position = v.position >= 0 ? v.position : 0;
      const scene = v.scene;
      if (line < 0) continue;
      results.push({ scene, line, position, length: v.variable.length, variable: v.variable, kind: v.kind });
    }
    return results;
  }
  findFirstEntryForBlock(blockId) {
    for (const entry of this.stmtToEntry.values()) {
      if (entry.blockId === blockId) return entry;
    }
    return null;
  }
  findLastEntryForBlock(blockId) {
    let best = null;
    for (const entry of this.stmtToEntry.values()) {
      if (entry.blockId !== blockId) continue;
      if (!best || entry.line > best.line) best = entry;
    }
    return best;
  }
  findLastEntryForScene(scene) {
    let best = null;
    for (const entry of this.stmtToEntry.values()) {
      if (entry.scene !== scene) continue;
      if (!best || entry.line > best.line) best = entry;
    }
    return best;
  }
  queryLocation(query) {
    const key = `${query.scene}:${query.line}`;
    const entries = this.bySceneLine.get(key) ?? [];
    let matched = entries;
    if (query.position !== void 0 && entries.length > 1) {
      const exact = entries.filter((e) => e.position === query.position);
      if (exact.length > 0) matched = exact;
    }
    const cfgId = matched.length > 0 ? matched[0].cfgId : null;
    return {
      entries: matched,
      cfgId,
      dataflow: cfgId ? this.resolveEntryStates(cfgId) : null
    };
  }
  queryVariable(query) {
    const name = query.variable.toLowerCase();
    return {
      variable: query.variable,
      definitions: this.variableDefs.get(name) ?? [],
      references: this.variableRefs.get(name) ?? [],
      deletes: this.variableDeletes.get(name) ?? []
    };
  }
  queryIdentifier(name) {
    return this.identifiers.get(name.toLowerCase()) ?? [];
  }
  allLocationsForLine(scene, line) {
    return this.bySceneLine.get(`${scene}:${line}`) ?? [];
  }
  resolveEntryStates(cfgId) {
    const direct = this.cfgEntryStates.get(cfgId);
    if (direct) return [direct];
    const state = this.dataflowByCfg.get(cfgId);
    if (!state) return null;
    return state.entryIds.map((id) => this.stateStore.get(id)).filter(Boolean);
  }
  getCfgDataflow(cfgId) {
    return this.resolveEntryStates(cfgId);
  }
  getDataflowForIdentifier(name, scene, line) {
    const occs = this.identifiers.get(name.toLowerCase());
    if (!occs) return null;
    const occ = occs.find((o) => o.scene === scene && o.line === line);
    if (!occ) return null;
    const entry = this.stmtToEntry.get(occ.statementId);
    if (!entry) return null;
    return this.resolveEntryStates(entry.cfgId);
  }
  getSceneSymbols(scene) {
    return this.sceneSymbols.get(scene);
  }
  isParamVariable(scene, variable) {
    const ss = this.sceneSymbols.get(scene);
    if (!ss) return false;
    return ss.paramVariables.has(variable.toLowerCase());
  }
  isGosubTarget(scene, label) {
    const key = `${scene.toLowerCase()}:${label.toLowerCase()}`;
    if (!this._gosubTargets) {
      this._gosubTargets = /* @__PURE__ */ new Set();
      for (const sceneName of this.allSceneNames) {
        const ss = this.sceneSymbols.get(sceneName);
        if (!ss) continue;
        for (const stmt of ss.gosubs) {
          const ref = extractStaticLabelTarget(stmt);
          if (ref) this._gosubTargets.add(`${ref.scene}:${ref.label}`);
        }
      }
    }
    return this._gosubTargets.has(key);
  }
  getGlobalDeclaration(variable) {
    return this.globalDeclarations.get(variable.toLowerCase());
  }
  getVariableToken(entry) {
    const stmt = this.statements[entry.statementId];
    if (!stmt) return null;
    switch (entry.statementKind) {
      case "DeclareVariable":
      case "DeclareArray":
      case "DeleteVariable":
      case "DeleteArray": {
        const v = stmt.variable;
        if (v?.value) return { line: v.lineNumber, position: v.position, length: v.value.length };
        return null;
      }
      case "SetVariable": {
        const tok = stmt.assignment ? stmt.expression?.token : stmt.expression?.left?.token;
        if (tok?.value) return { line: tok.lineNumber, position: tok.position, length: tok.value.length };
        return null;
      }
      case "InputText":
      case "InputNumber": {
        const v = stmt.storeInto;
        if (v?.value) return { line: v.lineNumber, position: v.position, length: v.value.length };
        return null;
      }
      case "GenerateRandom": {
        const v = stmt.identifier;
        if (v?.value) return { line: v.lineNumber, position: v.position, length: v.value.length };
        return null;
      }
      default:
        return null;
    }
  }
  findAchievementDefinition(codename) {
    const lower = codename.toLowerCase();
    for (const [sceneName, ss] of this.sceneSymbols) {
      const achievement = ss.achievements.get(lower);
      if (achievement) return { achievement, scene: sceneName };
    }
    return null;
  }
  findAchievementReferences(codename) {
    const lower = codename.toLowerCase();
    const results = [];
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const achieve of ss.achieves) {
        if (achieve.codename.value.toLowerCase() === lower) {
          results.push({
            scene: sceneName,
            line: achieve.codename.lineNumber,
            position: achieve.codename.position,
            length: achieve.codename.value.length
          });
        }
      }
    }
    return results;
  }
  getImageReferences() {
    const results = [];
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const img of ss.images) {
        const p = img.path;
        if (!p?.content) continue;
        results.push({
          path: p.content,
          scene: sceneName,
          line: p.lineNumber,
          position: p.position,
          length: p.content.length,
          alignment: img.alignment?.value,
          altText: img.altText?.content
        });
      }
    }
    return results;
  }
  get allGlobalDeclarations() {
    return this.globalDeclarations;
  }
  get allSceneNames() {
    return [...this.sceneSymbols.keys()];
  }
  getUnusedVariables() {
    const results = [];
    for (const [name, decl] of this.globalDeclarations) {
      if (isBuiltinVariable(name)) continue;
      const refs = this.variableRefs.get(name.toLowerCase());
      if (refs && refs.length > 0) continue;
      const tok = decl.variable;
      results.push({ name, scene: decl.token.sceneName, line: tok.lineNumber, position: tok.position, length: tok.value.length, scope: "Global" });
    }
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const [name, decl] of ss.tempVariables) {
        if (isBuiltinVariable(name)) continue;
        const refs = this.variableRefs.get(name.toLowerCase());
        if (refs && refs.length > 0) continue;
        const tok = decl.variable;
        results.push({ name, scene: sceneName, line: tok.lineNumber, position: tok.position, length: tok.value.length, scope: "Temporary" });
      }
    }
    return results;
  }
  getUnusedLabels() {
    const referenced = /* @__PURE__ */ new Set();
    for (const sceneName of this.allSceneNames) {
      const ss = this.sceneSymbols.get(sceneName);
      if (!ss) continue;
      for (const stmt of ss.gotos) {
        const ref = extractStaticLabelTarget(stmt);
        if (ref) referenced.add(`${ref.scene}:${ref.label}`);
      }
      for (const stmt of ss.gosubs) {
        const ref = extractStaticLabelTarget(stmt);
        if (ref) referenced.add(`${ref.scene}:${ref.label}`);
      }
    }
    const results = [];
    for (const [sceneName, ss] of this.sceneSymbols) {
      for (const [name, label] of ss.labels) {
        const key = `${sceneName.toLowerCase()}:${name.toLowerCase()}`;
        if (referenced.has(key)) continue;
        results.push({
          name,
          scene: sceneName,
          line: label.label.lineNumber,
          position: label.label.position,
          length: label.label.value.length
        });
      }
    }
    return results;
  }
  getAchievementVariableConflicts() {
    const results = [];
    const globalLower = /* @__PURE__ */ new Map();
    for (const name of this.globalDeclarations.keys()) {
      globalLower.set(name.toLowerCase(), name);
    }
    const tempLower = /* @__PURE__ */ new Map();
    for (const [, ss] of this.sceneSymbols) {
      for (const name of ss.tempVariables.keys()) {
        tempLower.set(name.toLowerCase(), name);
      }
      for (const name of ss.paramVariables) {
        tempLower.set(name.toLowerCase(), name);
      }
    }
    for (const [, ss] of this.sceneSymbols) {
      for (const [lower, achievement] of ss.achievements) {
        const globalMatch = globalLower.get(lower);
        const tempMatch = tempLower.get(lower);
        const match = globalMatch ?? tempMatch;
        if (!match) continue;
        const tok = achievement.codename;
        results.push({ codename: tok.value, variable: match, scene: tok.sceneName, line: tok.lineNumber, position: tok.position, length: tok.value.length });
      }
    }
    return results;
  }
  unreachableStatements() {
    if (this.reachableCfgs.size === 0) return [];
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of this.stmtToEntry.values()) {
      if (this.reachableCfgs.has(entry.cfgId)) continue;
      const key = `${entry.scene}:${entry.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(entry);
    }
    return results;
  }
  stats() {
    return {
      statements: this.stmtToEntry.size,
      lines: this.bySceneLine.size,
      cfgsWithDataflow: this.cfgEntryStates.size || this.dataflowByCfg.size
    };
  }
  ensureSceneSymbols(scene) {
    let s = this.sceneSymbols.get(scene);
    if (!s) {
      s = {
        labels: /* @__PURE__ */ new Map(),
        tempVariables: /* @__PURE__ */ new Map(),
        paramVariables: /* @__PURE__ */ new Set(),
        achievements: /* @__PURE__ */ new Map(),
        achieves: [],
        images: [],
        gotos: [],
        gosubs: []
      };
      this.sceneSymbols.set(scene, s);
    }
    return s;
  }
  indexSymbol(stmt, scene) {
    const ss = this.ensureSceneSymbols(scene);
    switch (stmt.kind) {
      case "Label": {
        const label = stmt;
        ss.labels.set(label.label.value, label);
        break;
      }
      case "DeclareVariable": {
        const decl = stmt;
        if (decl.scope === "Global") {
          this.globalDeclarations.set(decl.variable.value.toLowerCase(), decl);
        } else {
          ss.tempVariables.set(decl.variable.value.toLowerCase(), decl);
        }
        break;
      }
      case "GotoLabel":
      case "GotoScene":
        ss.gotos.push(stmt);
        break;
      case "GoSub":
      case "GoSubScene":
        ss.gosubs.push(stmt);
        break;
      case "Parameters": {
        const params = stmt;
        for (const id of params.identifiers) {
          ss.paramVariables.add(id.value.toLowerCase());
        }
        break;
      }
      case "Achievement": {
        const achievement = stmt;
        ss.achievements.set(achievement.codename.value.toLowerCase(), achievement);
        break;
      }
      case "Achieve": {
        ss.achieves.push(stmt);
        break;
      }
      case "Image": {
        ss.images.push(stmt);
        break;
      }
      case "TextImage": {
        ss.images.push(stmt);
        break;
      }
    }
  }
  pushIdentifier(token, role, entry) {
    if (!token?.value) return;
    const name = token.value.toLowerCase();
    const occ = {
      name,
      scene: entry.scene,
      line: token.lineNumber,
      position: token.position,
      length: token.value.length,
      role,
      statementId: entry.statementId,
      statementKind: entry.statementKind
    };
    const list = this.identifiers.get(name);
    if (list) list.push(occ);
    else this.identifiers.set(name, [occ]);
  }
  indexVariable(stmt, stmtId, entry) {
    const s = stmt;
    if (stmt.kind === "DeleteVariable" || stmt.kind === "DeleteArray") {
      const name = s.variable?.value?.toLowerCase();
      if (name) {
        const list = this.variableDeletes.get(name);
        if (list) list.push(entry);
        else this.variableDeletes.set(name, [entry]);
      }
      this.pushIdentifier(s.variable, "delete", entry);
      return;
    }
    if (stmt.kind === "Parameters") {
      for (const id of s.identifiers) {
        const name = id.value?.toLowerCase();
        if (name) {
          const list = this.variableDefs.get(name);
          if (list) list.push(entry);
          else this.variableDefs.set(name, [entry]);
        }
        this.pushIdentifier(id, "definition", entry);
      }
      return;
    }
    if (stmt.kind === "DeclareVariable" || stmt.kind === "DeclareArray") {
      const name = s.variable?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(s.variable, "definition", entry);
      if (stmt.kind === "DeclareArray" && s.declarations) {
        for (const decl of s.declarations) {
          const dn = decl.variable?.value?.toLowerCase();
          if (dn) {
            const list = this.variableDefs.get(dn);
            if (list) list.push(entry);
            else this.variableDefs.set(dn, [entry]);
          }
          this.pushIdentifier(decl.variable, "definition", entry);
        }
      }
      return;
    }
    if (stmt.kind === "SetVariable") {
      const tok = s.assignment ? s.expression?.token : s.expression?.left?.token;
      const name = tok?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(tok, "definition", entry);
    }
    if (stmt.kind === "InputText" || stmt.kind === "InputNumber") {
      const name = s.storeInto?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(s.storeInto, "definition", entry);
    }
    if (stmt.kind === "GenerateRandom") {
      const name = s.identifier?.value?.toLowerCase();
      if (name) {
        const list = this.variableDefs.get(name);
        if (list) list.push(entry);
        else this.variableDefs.set(name, [entry]);
      }
      this.pushIdentifier(s.identifier, "definition", entry);
    }
    this.extractRefs(stmt, entry);
  }
  extractRefs(stmt, entry) {
    const refs = this.collectIdentifierTokens(stmt);
    for (const ref of refs) {
      const refEntry = {
        ...entry,
        line: ref.line,
        position: ref.position,
        variableLength: ref.length
      };
      const list = this.variableRefs.get(ref.name);
      if (list) list.push(refEntry);
      else this.variableRefs.set(ref.name, [refEntry]);
      this.pushIdentifier({ value: ref.originalName, lineNumber: ref.line, position: ref.position }, "reference", entry);
    }
  }
  collectIdentifierTokens(stmt) {
    const s = stmt;
    const results = [];
    const walkExpr = (expr) => {
      if (!expr) return;
      if (expr.token?.type === "Identifier") {
        const v = expr.token.value;
        if (v) results.push({ name: v.toLowerCase(), originalName: v, line: expr.token.lineNumber, position: expr.token.position, length: v.length });
      }
      if (expr.left) walkExpr(expr.left);
      if (expr.right) walkExpr(expr.right);
      if (expr.value && typeof expr.value === "object" && expr.operator) walkExpr(expr.value);
      if (expr.expression) walkExpr(expr.expression);
      if (expr.identifier) {
        const v = expr.identifier.value;
        if (v) results.push({ name: v.toLowerCase(), originalName: v, line: expr.identifier.lineNumber, position: expr.identifier.position, length: v.length });
      }
    };
    const pushExpr = (e) => {
      if (e) walkExpr(e);
    };
    const walkSegments2 = (segments) => {
      for (const seg of segments) {
        pushExpr(seg.expression);
        pushExpr(seg.selector);
        if (seg.alternatives) {
          for (const alt of seg.alternatives) {
            if (alt.segments) walkSegments2(alt.segments);
          }
        }
      }
    };
    switch (stmt.kind) {
      case "SetVariable":
        if (s.assignment) {
          pushExpr(s.assignment);
        } else {
          pushExpr(s.expression);
        }
        break;
      case "DeclareVariable":
        pushExpr(s.expression);
        break;
      case "If":
      case "ElseIf":
      case "SelectableIf":
      case "Expression":
        pushExpr(s.expression);
        break;
      case "GenerateRandom":
        pushExpr(s.min);
        pushExpr(s.max);
        break;
      case "InputNumber":
        pushExpr(s.min);
        pushExpr(s.max);
        break;
      case "Round":
      case "Length":
        pushExpr(s.expression);
        break;
      case "Prose":
      case "ChoiceOption":
        if (s.parsedSegments) {
          walkSegments2(s.parsedSegments);
        }
        if (stmt.kind === "ChoiceOption") pushExpr(s.selectableIf);
        break;
      default:
        pushExpr(s.expression);
        pushExpr(s.selector);
        break;
    }
    return results;
  }
};
var BUILTIN_VARIABLES = /* @__PURE__ */ new Set([
  "choice_randomtest",
  "choice_quicktest",
  "choice_randomscene",
  "choice_nightmode",
  "choice_saved_is_allowed",
  "choice_save_name",
  "choice_time_stamp",
  "choice_restore_purchases_allowed",
  "choice_purchased_adfree",
  "choice_is_trial",
  "choice_is_advertising_supported",
  "choice_is_web",
  "choice_is_steam",
  "choice_is_ios",
  "choice_is_android",
  "choice_is_omnibus",
  "choice_release_date",
  "choice_prerelease",
  "choice_subscribe_allowed",
  "choice_subscribed",
  "true",
  "false",
  "implicit_control_flow"
]);
var isBuiltinVariable = (name) => BUILTIN_VARIABLES.has(name.toLowerCase()) || name.toLowerCase().startsWith("choice_");
function extractStaticLabelTarget(stmt) {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    const label = stmt.label;
    if (label && "value" in label) {
      return { scene: stmt.token.sceneName.toLowerCase(), label: label.value.toLowerCase() };
    }
  }
  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    const scene = stmt.scene;
    const label = stmt.label;
    if (scene && "value" in scene && label && "value" in label) {
      return { scene: scene.value.toLowerCase(), label: label.value.toLowerCase() };
    }
  }
  return null;
}
var deserializeToVariableState = (s) => ({
  parent: null,
  globals: new Map(Object.entries(s.globals)),
  temps: new Map(
    Object.entries(s.temps).map(([scene, vars]) => [scene, new Map(Object.entries(vars))])
  )
});
var MultiMap = class {
  map = /* @__PURE__ */ new Map();
  add(key, value) {
    const list = this.map.get(key);
    if (list) list.push(value);
    else this.map.set(key, [value]);
  }
  getAll(key) {
    return this.map.get(key) ?? [];
  }
};
var applyEffect = (stmt, state, scene) => {
  if (stmt.kind === "Parameters") {
    const params = stmt;
    for (const id of params.identifiers) {
      const existing = getVariable(state, id.value, scene);
      if (existing.kind === "bottom") {
        setVariableMut(state, id.value, bottom, "Temporary", scene);
      }
    }
    return;
  }
  const effect = extractEffect(stmt);
  if (!effect.defines) return;
  const { variable, scope, valueExpression, isCompoundAssignment, compoundExpression } = effect.defines;
  let value;
  if (stmt.kind === "InputText" || stmt.kind === "InputNumber") {
    value = { kind: "input" };
  } else if (stmt.kind === "GenerateRandom") {
    const s = stmt;
    const minVal = evaluateExpression(s.min, state, scene);
    const maxVal = evaluateExpression(s.max, state, scene);
    if (minVal.kind === "constant" && typeof minVal.value === "number" && maxVal.kind === "constant" && typeof maxVal.value === "number") {
      value = { kind: "range", min: minVal.value, max: maxVal.value };
    } else {
      value = top;
    }
  } else if (isCompoundAssignment && compoundExpression) {
    value = evaluateExpression(compoundExpression, state, scene);
  } else if (valueExpression) {
    value = evaluateExpression(valueExpression, state, scene);
  } else {
    value = scope === "Global" ? { kind: "constant", value: false } : { kind: "constant", value: "" };
  }
  if (scope === "Temporary") {
    setVariableMut(state, variable, value, "Temporary", scene);
  } else {
    updateVariableMut(state, variable, value, scene);
  }
};

// ../analysis/ref-cfg/passes/navigation-pass.ts
var navigationExitKinds = /* @__PURE__ */ new Set([
  "Goto",
  "GotoScene",
  "GoSubCall",
  "GoSubSceneCall"
]);
var lastStatementInBlock = (blockId, blockIndex, statements) => {
  const block = blockIndex[blockId];
  if (!block || block.statementIds.length === 0) return void 0;
  const lastId = block.statementIds[block.statementIds.length - 1];
  return statements[lastId];
};
var checkUnresolvedLocalEdges = (sceneCfg, statements) => {
  const errors = [];
  for (const edge of sceneCfg.unresolvedEdges) {
    if (edge.metadata.dynamicExpression) continue;
    const stmt = lastStatementInBlock(edge.sourceBlockId, sceneCfg.blockIndex, statements);
    if (!stmt) continue;
    const label = edge.metadata.label;
    if (label) {
      errors.push({
        message: `Label "${label}" not found in scene "${sceneCfg.sceneName}"`,
        statement: stmt,
        severity: "Error",
        solutionCode: 0,
        targetLabel: label,
        context: {}
      });
    }
  }
  return errors;
};
var checkUnresolvedExits = (linked, blockIndex, statements, sceneCfgs) => {
  const errors = [];
  for (const exit of linked.unresolvedExits) {
    if (exit.metadata.dynamicExpression) continue;
    if (!navigationExitKinds.has(exit.kind)) continue;
    const stmt = lastStatementInBlock(exit.blockId, blockIndex, statements);
    if (!stmt) continue;
    const targetScene = exit.metadata.targetScene;
    const targetLabel = exit.metadata.targetSceneLabel ?? exit.metadata.label;
    if (targetScene && targetLabel) {
      const foundInScenes = [];
      for (const [name, cfg] of sceneCfgs) {
        if (name.toLowerCase() === targetScene.toLowerCase()) continue;
        const blockId = cfg.labelToBlockId[targetLabel];
        if (blockId !== void 0) {
          const block = cfg.blockIndex[blockId];
          const firstStmtId = block?.statementIds[0];
          const firstStmt = firstStmtId ? statements[firstStmtId] : void 0;
          const line = firstStmt?.token?.lineNumber ?? 0;
          foundInScenes.push({ scene: name, line });
        }
      }
      errors.push({
        message: `Label "${targetLabel}" not found in scene "${targetScene}"`,
        statement: stmt,
        severity: "Error",
        solutionCode: 0,
        targetScene,
        targetLabel,
        context: { tryDownload: targetLabel, foundInScenes }
      });
    } else if (targetScene) {
      errors.push({
        message: `Scene "${targetScene}" not found`,
        statement: stmt,
        severity: "Error",
        solutionCode: 1,
        targetScene,
        context: { tryFetchScene: targetScene }
      });
    } else if (targetLabel) {
      errors.push({
        message: `Label "${targetLabel}" not found`,
        statement: stmt,
        severity: "Error",
        solutionCode: 0,
        targetLabel,
        context: {}
      });
    }
  }
  return errors;
};
var checkNavigation = (linked, sceneCfgs, blockIndex, statements) => {
  const errors = [];
  for (const [, sceneCfg] of sceneCfgs) {
    errors.push(...checkUnresolvedLocalEdges(sceneCfg, statements));
  }
  errors.push(...checkUnresolvedExits(linked, blockIndex, statements, sceneCfgs));
  return errors;
};

// ../analysis/ref-cfg/api.ts
var linkInterSceneControlFlow = (scenes, plan) => {
  const linked = linkCfgs(scenes, plan.cfgs, plan.sceneCfgs);
  const blockToCfg = /* @__PURE__ */ new Map();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      blockToCfg.set(blockId, cfg.id);
    }
  }
  const cfgSuccessors = /* @__PURE__ */ new Map();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const exit of cfg.exits) {
      if (exit.target.type === "cfg") {
        getOrSet(cfgSuccessors, cfg.id, () => /* @__PURE__ */ new Set()).add(exit.target.cfgId);
      }
      if (exit.continuation) {
        const contCfgId = linked.cfgs[exit.continuation] ? exit.continuation : blockToCfg.get(exit.continuation);
        if (contCfgId) {
          getOrSet(cfgSuccessors, cfg.id, () => /* @__PURE__ */ new Set()).add(contCfgId);
        }
      }
    }
  }
  const locationIndex = new LocationIndex(plan.blockIndex, plan.statements, blockToCfg);
  return {
    linked,
    transfers: plan.transfers,
    scopes: plan.scopes,
    blockIndex: plan.blockIndex,
    statements: plan.statements,
    sceneCfgs: plan.sceneCfgs,
    blockToCfg,
    cfgSuccessors,
    locationIndex
  };
};
var verifyNavigation = (result) => checkNavigation(result.linked, result.sceneCfgs, result.blockIndex, result.statements);
var analyseLoops = (result) => analyseCfgLoops(result.linked, result.transfers, result.blockToCfg, result.cfgSuccessors, result.blockIndex, result.statements);
var buildGraph = (result) => buildCfgGraph(result.linked, result.blockToCfg);
var buildGlobalSymbolTable = (result, cfgOrder) => extractSymbols(result.linked, cfgOrder, result.blockIndex, result.statements);
var attachReachability = (result, graph) => {
  const reachable = /* @__PURE__ */ new Set();
  const queue = [result.linked.entryCfgId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const succ of graph.successors.get(id) ?? []) {
      queue.push(succ);
    }
  }
  result.locationIndex.attachReachability(reachable);
};
var findUnreachableCodeFromCfgIds = (result, hasState) => {
  const statsCfgIds = new Set(result.linked.statsCfgIds);
  const items = [];
  for (const cfg of Object.values(result.linked.cfgs)) {
    if (hasState.has(cfg.id)) continue;
    if (statsCfgIds.has(cfg.id)) continue;
    const block = result.blockIndex[cfg.entryBlockId];
    if (!block?.statementIds.length) continue;
    const firstStmtId = block.statementIds[0];
    const stmt = result.statements[firstStmtId];
    if (!stmt) continue;
    const token = stmt.token;
    if (!token) continue;
    const parts = cfg.id.split(":");
    const label = parts[1] ?? "";
    let reason;
    if (label === "") {
      reason = "dead-scene";
    } else if (label.includes("__cont_")) {
      reason = "dead-continuation";
    } else {
      reason = "dead-label";
    }
    items.push({
      scene: cfg.scene,
      line: token.lineNumber,
      position: token.position ?? 0,
      cfgId: cfg.id,
      label,
      reason
    });
  }
  result.locationIndex.attachUnreachableCode(items);
};

// ../analysis/segments/build-segments.ts
var buildBlockToCfg = (linked) => {
  const map = /* @__PURE__ */ new Map();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const blockId of Object.keys(cfg.blocks)) {
      map.set(blockId, { cfgId: cfg.id, cfg });
    }
  }
  return map;
};
var buildGlobalEdgesBySource = (linked) => {
  const map = /* @__PURE__ */ new Map();
  for (const cfg of Object.values(linked.cfgs)) {
    for (const edge of cfg.edges) {
      getOrSet(map, edge.sourceBlockId, () => []).push(edge);
    }
  }
  return map;
};
var findSeeds = (linked, blockToCfg, edgesBySource) => {
  const seeds = [];
  const entryCfg = linked.cfgs[linked.entryCfgId];
  if (entryCfg) {
    seeds.push({
      entry: {
        cfgId: linked.entryCfgId,
        blockId: entryCfg.entryBlockId,
        kind: "game-start"
      },
      startBlockId: entryCfg.entryBlockId
    });
  }
  for (const cfg of Object.values(linked.cfgs)) {
    for (const edge of cfg.edges) {
      if (edge.kind === "InputReturn" && edge.targetBlockId) {
        const loc2 = blockToCfg.get(edge.targetBlockId);
        if (loc2) {
          seeds.push({
            entry: {
              cfgId: loc2.cfgId,
              blockId: edge.targetBlockId,
              kind: "input-continuation"
            },
            startBlockId: edge.targetBlockId
          });
        }
        continue;
      }
      if (!isChoiceOptionEdge(edge.kind) || !edge.targetBlockId) continue;
      const loc = blockToCfg.get(edge.targetBlockId);
      if (!loc) continue;
      seeds.push({
        entry: {
          cfgId: loc.cfgId,
          blockId: edge.targetBlockId,
          kind: "choice-option",
          edgeKind: edge.kind,
          metadata: edge.metadata
        },
        startBlockId: edge.targetBlockId
      });
    }
  }
  return seeds;
};
var floodFromBlock = (startBlockId, owningCfgId, linked, blockToCfg, edgesBySource) => {
  const blockIds = [];
  const exits = [];
  const gosubBindings = [];
  const visitedBlocks = /* @__PURE__ */ new Set();
  const queue = [startBlockId];
  let qi = 0;
  while (qi < queue.length) {
    const blockId = queue[qi++];
    if (visitedBlocks.has(blockId)) continue;
    visitedBlocks.add(blockId);
    const loc = blockToCfg.get(blockId);
    if (!loc) continue;
    blockIds.push(blockId);
    const ref = loc.cfg.blocks[blockId];
    if (!ref) continue;
    if (ref.exitType === "Choice") {
      exits.push({ cfgId: loc.cfgId, blockId, kind: "choice" });
      continue;
    }
    if (ref.exitType === "Input") {
      exits.push({ cfgId: loc.cfgId, blockId, kind: "input" });
      continue;
    }
    if (ref.exitType === "Finish" || ref.exitType === "Ending" || ref.exitType === "ImplicitEnd") {
      exits.push({ cfgId: loc.cfgId, blockId, kind: "terminal" });
      continue;
    }
    const outEdges = edgesBySource.get(blockId) ?? [];
    for (const edge of outEdges) {
      if (isChoiceOptionEdge(edge.kind)) continue;
      if (edge.targetBlockId && !visitedBlocks.has(edge.targetBlockId)) {
        queue.push(edge.targetBlockId);
      }
    }
    for (const exit of loc.cfg.exits) {
      if (exit.blockId !== blockId) continue;
      if (exit.target.type === "terminal" || exit.kind === "GameEnd") {
        exits.push({ cfgId: loc.cfgId, blockId, kind: "terminal" });
        continue;
      }
      if (exit.target.type !== "cfg") continue;
      const targetCfg = linked.cfgs[exit.target.cfgId];
      if (!targetCfg) continue;
      if (isGoSubCall(exit.kind)) {
        gosubBindings.push({
          callerCfgId: loc.cfgId,
          callerBlockId: blockId,
          targetCfgId: exit.target.cfgId,
          continuationCfgId: exit.continuation && linked.cfgs[exit.continuation] ? exit.continuation : void 0
        });
        queue.push(targetCfg.entryBlockId);
        if (exit.continuation) {
          const contCfg = linked.cfgs[exit.continuation];
          if (contCfg) queue.push(contCfg.entryBlockId);
        }
        continue;
      }
      queue.push(targetCfg.entryBlockId);
    }
  }
  return { blockIds, exits, gosubBindings };
};
var extractSegmentEffects = (blockIds, blockIndex, statements) => {
  const byVar = /* @__PURE__ */ new Map();
  for (const blockId of blockIds) {
    const block = blockIndex[blockId];
    if (!block) continue;
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      const effect = extractEffect(stmt);
      if (!effect.defines) continue;
      const varName = effect.defines.variable.toLowerCase();
      const ops = getOrSet(byVar, varName, () => []);
      if (!effect.defines.isCompoundAssignment) {
        const expr = effect.defines.valueExpression;
        const val = extractLiteralValue(expr);
        ops.push({ kind: "assign", value: val });
      } else {
        const compound = effect.defines.compoundExpression;
        if (compound && compound.kind === "Binary") {
          const bin = compound;
          const opType = bin.operator?.type;
          const rhs = extractNumericLiteral(bin.right);
          ops.push({ kind: "compound", operator: opType ?? "?", operand: rhs });
        } else {
          ops.push({ kind: "compound", operator: "?", operand: null });
        }
      }
    }
  }
  return [...byVar.entries()].map(([variable, ops]) => ({ variable, ops }));
};
var extractLiteralValue = (expr) => {
  if (!expr) return void 0;
  if (expr.kind === "Literal") return expr.value?.value;
  if (expr.kind === "Grouping") return extractLiteralValue(expr.expression);
  return void 0;
};
var extractNumericLiteral = (expr) => {
  if (!expr) return null;
  if (expr.kind === "Literal" && typeof expr.value?.value === "number") return expr.value.value;
  if (expr.kind === "Grouping") return extractNumericLiteral(expr.expression);
  return null;
};
var resolveSelectableIf = (entry, statements) => {
  const stmtId = entry.metadata?.conditionStatementId;
  if (!stmtId || entry.metadata?.choiceConditionKind !== "selectable_if") return;
  const stmt = statements[stmtId];
  if (stmt?.selectableIf) {
    entry.selectableIf = stmt.selectableIf;
  }
};
var PASSTHROUGH_KINDS = /* @__PURE__ */ new Set([
  "ChoiceOption",
  "GotoLabel",
  "GotoScene",
  "Label"
]);
var resolvePassthrough = (startBlockId, linked, blockToCfg, edgesBySource, blockIndex, statements) => {
  if (!blockIndex || !statements) return startBlockId;
  let current = startBlockId;
  const visited = /* @__PURE__ */ new Set();
  while (!visited.has(current)) {
    visited.add(current);
    const block = blockIndex[current];
    if (!block) break;
    const hasContent = block.statementIds.some((sid) => {
      const stmt = statements[sid];
      return stmt != null && !PASSTHROUGH_KINDS.has(stmt.kind);
    });
    if (hasContent) break;
    const loc = blockToCfg.get(current);
    if (!loc) break;
    let nextBlock = null;
    for (const exit of loc.cfg.exits) {
      if (exit.blockId !== current) continue;
      if (exit.target.type === "cfg" && !isGoSubCall(exit.kind)) {
        const targetCfg = linked.cfgs[exit.target.cfgId];
        if (targetCfg) {
          nextBlock = targetCfg.entryBlockId;
          break;
        }
      }
    }
    if (!nextBlock) {
      const outEdges = (edgesBySource.get(current) ?? []).filter((e) => !isChoiceOptionEdge(e.kind) && e.targetBlockId);
      if (outEdges.length === 1) nextBlock = outEdges[0].targetBlockId;
    }
    if (nextBlock) current = nextBlock;
    else break;
  }
  return current;
};
var buildSegments = (linked, blockIndex, statements) => {
  const blockToCfg = buildBlockToCfg(linked);
  const edgesBySource = buildGlobalEdgesBySource(linked);
  const seeds = findSeeds(linked, blockToCfg, edgesBySource);
  const segments = {};
  const segmentByEntry = /* @__PURE__ */ new Map();
  let nextId = 0;
  for (const seed of seeds) {
    const effectiveStart = resolvePassthrough(
      seed.startBlockId,
      linked,
      blockToCfg,
      edgesBySource,
      blockIndex,
      statements
    );
    if (segmentByEntry.has(effectiveStart)) {
      const existingId = segmentByEntry.get(effectiveStart);
      if (statements) resolveSelectableIf(seed.entry, statements);
      seed.entry.blockId = effectiveStart;
      const effectiveLoc2 = blockToCfg.get(effectiveStart);
      if (effectiveLoc2) seed.entry.cfgId = effectiveLoc2.cfgId;
      segments[existingId].entries.push(seed.entry);
      continue;
    }
    const result = floodFromBlock(effectiveStart, seed.entry.cfgId, linked, blockToCfg, edgesBySource);
    const id = `seg_${nextId++}`;
    seed.entry.blockId = effectiveStart;
    const effectiveLoc = blockToCfg.get(effectiveStart);
    if (effectiveLoc) seed.entry.cfgId = effectiveLoc.cfgId;
    if (statements) resolveSelectableIf(seed.entry, statements);
    const effects = blockIndex && statements ? extractSegmentEffects(result.blockIds, blockIndex, statements) : [];
    segments[id] = {
      id,
      cfgId: seed.entry.cfgId,
      entries: [seed.entry],
      exits: result.exits,
      blockIds: result.blockIds,
      gosubBindings: result.gosubBindings,
      effects
    };
    segmentByEntry.set(effectiveStart, id);
  }
  const edges = [];
  for (const segment of Object.values(segments)) {
    for (const exit of segment.exits) {
      if (exit.kind === "choice") {
        const outEdges = edgesBySource.get(exit.blockId) ?? [];
        for (const edge of outEdges) {
          if (!isChoiceOptionEdge(edge.kind) || !edge.targetBlockId) continue;
          const effectiveTarget = resolvePassthrough(
            edge.targetBlockId,
            linked,
            blockToCfg,
            edgesBySource,
            blockIndex,
            statements
          );
          const targetSegId = segmentByEntry.get(effectiveTarget);
          if (targetSegId) {
            edges.push({
              sourceSegmentId: segment.id,
              targetSegmentId: targetSegId,
              exitBlockId: exit.blockId,
              entryBlockId: effectiveTarget,
              metadata: edge.metadata
            });
          }
        }
      } else if (exit.kind === "input") {
        const outEdges = edgesBySource.get(exit.blockId) ?? [];
        for (const edge of outEdges) {
          if (edge.kind !== "InputReturn" || !edge.targetBlockId) continue;
          const targetSegId = segmentByEntry.get(edge.targetBlockId);
          if (targetSegId) {
            edges.push({
              sourceSegmentId: segment.id,
              targetSegmentId: targetSegId,
              exitBlockId: exit.blockId,
              entryBlockId: edge.targetBlockId
            });
          }
        }
      }
    }
  }
  const entryCfg = linked.cfgs[linked.entryCfgId];
  const entrySegmentId = entryCfg ? segmentByEntry.get(entryCfg.entryBlockId) ?? Object.keys(segments)[0] : Object.keys(segments)[0];
  return { segments, edges, entrySegmentId };
};

// ../analysis/segments/segment-loop-analysis.ts
var tarjanScc = (graph) => {
  const succs = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    getOrSet(succs, edge.sourceSegmentId, () => /* @__PURE__ */ new Set()).add(edge.targetSegmentId);
  }
  const ids = Object.keys(graph.segments);
  const index = /* @__PURE__ */ new Map();
  const lowlink = /* @__PURE__ */ new Map();
  const onStack = /* @__PURE__ */ new Set();
  const stack = [];
  const components = [];
  let nextIndex = 0;
  const strongConnect = (v) => {
    const vStack = [];
    let current = v;
    outer: while (true) {
      if (!index.has(current)) {
        index.set(current, nextIndex);
        lowlink.set(current, nextIndex);
        nextIndex++;
        stack.push(current);
        onStack.add(current);
      }
      const succSet = succs.get(current);
      let iter;
      const frame = vStack.length > 0 ? vStack[vStack.length - 1] : null;
      if (frame && frame.node === current) {
        iter = frame.succIter;
      } else {
        iter = succSet ? succSet[Symbol.iterator]() : [][Symbol.iterator]();
        vStack.push({ node: current, succIter: iter });
      }
      while (true) {
        const next = iter.next();
        if (next.done) break;
        const w = next.value;
        if (!index.has(w)) {
          current = w;
          continue outer;
        } else if (onStack.has(w)) {
          lowlink.set(current, Math.min(lowlink.get(current), index.get(w)));
        }
      }
      if (lowlink.get(current) === index.get(current)) {
        const component = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          component.push(w);
        } while (w !== current);
        components.push(component);
      }
      vStack.pop();
      if (vStack.length === 0) break;
      const parent = vStack[vStack.length - 1];
      lowlink.set(parent.node, Math.min(lowlink.get(parent.node), lowlink.get(current)));
      current = parent.node;
    }
  };
  for (const id of ids) {
    if (!index.has(id)) strongConnect(id);
  }
  return { components, succs };
};
var analyseSegmentLoops = (graph) => {
  const { components, succs } = tarjanScc(graph);
  components.reverse();
  const edgesBySource = /* @__PURE__ */ new Map();
  for (const edge of graph.edges) {
    getOrSet(edgesBySource, edge.sourceSegmentId, () => []).push(edge);
  }
  const isCyclic = (scc) => {
    if (scc.length > 1) return true;
    const s = succs.get(scc[0]);
    return s !== void 0 && s.has(scc[0]);
  };
  const loops = [];
  const segmentToLoop = /* @__PURE__ */ new Map();
  const acyclicOrder = [];
  for (const scc of components) {
    if (!isCyclic(scc)) {
      acyclicOrder.push(scc[0]);
      continue;
    }
    const members = new Set(scc);
    const headerIds = [];
    for (const segId of scc) {
      const seg = graph.segments[segId];
      if (!seg) continue;
      if (segId === graph.entrySegmentId) {
        headerIds.push(segId);
        continue;
      }
      for (const edge of graph.edges) {
        if (edge.targetSegmentId === segId && !members.has(edge.sourceSegmentId)) {
          headerIds.push(segId);
          break;
        }
      }
    }
    const backEdges = [];
    const headerSet = new Set(headerIds);
    for (const segId of scc) {
      for (const edge of edgesBySource.get(segId) ?? []) {
        if (headerSet.has(edge.targetSegmentId) && members.has(edge.sourceSegmentId)) {
          backEdges.push(edge);
        }
      }
    }
    const exitEdges = [];
    for (const segId of scc) {
      for (const edge of edgesBySource.get(segId) ?? []) {
        if (!members.has(edge.targetSegmentId)) {
          exitEdges.push(edge);
        }
      }
    }
    const choiceOptionEntries = /* @__PURE__ */ new Set();
    let allHideReuse = true;
    let hasAnyReuse = false;
    for (const segId of scc) {
      const seg = graph.segments[segId];
      if (!seg) continue;
      for (const entry of seg.entries) {
        if (entry.kind === "choice-option") {
          choiceOptionEntries.add(entry.blockId);
          const reuse = entry.metadata?.effectiveReuse;
          if (reuse === "hide_reuse" || reuse === "disable_reuse") {
            hasAnyReuse = true;
          } else {
            allHideReuse = false;
          }
        }
      }
    }
    for (const edge of backEdges) {
      const reuse = edge.metadata?.effectiveReuse;
      if (reuse === "hide_reuse" || reuse === "disable_reuse") {
        hasAnyReuse = true;
      }
    }
    let bound;
    let choiceOptionCount = null;
    let drainTags = [];
    if (choiceOptionEntries.size > 0 && allHideReuse && hasAnyReuse) {
      bound = "choice-bounded";
      choiceOptionCount = choiceOptionEntries.size;
    } else if (hasConditionGuard(backEdges)) {
      bound = "condition-bounded";
      drainTags = detectDrainTags(scc, graph);
      if (drainTags.length > 0) {
        bound = "choice-bounded";
        choiceOptionCount = drainTags.length;
      }
    } else {
      bound = "unbounded";
    }
    const infinite = exitEdges.length === 0;
    let iterCap;
    if (infinite) {
      iterCap = 1;
    } else if (bound === "choice-bounded" && choiceOptionCount !== null) {
      iterCap = choiceOptionCount + 2;
    } else if (bound === "condition-bounded") {
      iterCap = 8;
    } else {
      iterCap = 3;
    }
    const loop2 = {
      headerIds,
      memberIds: scc,
      backEdges,
      exitEdges,
      bound,
      infinite,
      choiceOptionCount,
      allHideReuse: allHideReuse && hasAnyReuse,
      iterCap,
      drainTags
    };
    loops.push(loop2);
    for (const segId of scc) {
      segmentToLoop.set(segId, loop2);
    }
    for (const segId of scc) {
      acyclicOrder.push(segId);
    }
  }
  return { loops, segmentToLoop, acyclicOrder };
};
var hasConditionGuard = (backEdges) => {
  for (const edge of backEdges) {
    if (edge.metadata?.conditionStatementId || edge.metadata?.choiceConditionId) {
      return true;
    }
  }
  return false;
};
var unwrapGrouping2 = (expr) => {
  while (expr && expr.kind === "Grouping") expr = expr.expression;
  return expr;
};
var extractConditionVarName = (expr) => {
  if (!expr) return null;
  if (expr.kind === "Identifier") return expr.token?.value?.toLowerCase() ?? null;
  return null;
};
var collectEntryTags = (cond, segEffects, segmentId) => {
  if (!cond) return [];
  cond = unwrapGrouping2(cond);
  if (!cond) return [];
  if (cond.kind === "Binary" && cond.operator?.type === "LogicalAnd") {
    return [
      ...collectEntryTags(cond.left, segEffects, segmentId),
      ...collectEntryTags(cond.right, segEffects, segmentId)
    ];
  }
  const boolTag = matchBooleanFlipTag(cond, segEffects, segmentId);
  if (boolTag) return [boolTag];
  const drainTag = matchMonotoneDrainTag(cond, segEffects, segmentId);
  if (drainTag) return [drainTag];
  return [];
};
var matchBooleanFlipTag = (cond, effects, segmentId) => {
  if (cond.kind !== "Unary" || cond.operator?.type !== "NotOperator") return null;
  const inner = unwrapGrouping2(cond.value);
  const varName = extractConditionVarName(inner);
  if (!varName) return null;
  const effect = effects.find((e) => e.variable === varName);
  if (!effect) return null;
  const setsTrue = effect.ops.some((op) => op.kind === "assign" && op.value === true);
  return setsTrue ? { kind: "boolean-flip", variable: varName, segmentId } : null;
};
var matchMonotoneDrainTag = (cond, segEffects, segmentId) => {
  if (cond.kind !== "Binary") return null;
  const opType = cond.operator?.type;
  let varName = null;
  let threshold = null;
  if (opType === "GreaterThanEqualsOperator" || opType === "GreaterThanOperator") {
    varName = extractConditionVarName(unwrapGrouping2(cond.left));
    const rhs = unwrapGrouping2(cond.right);
    if (rhs?.kind === "Literal" && typeof rhs.value?.value === "number") {
      threshold = rhs.value.value;
      if (opType === "GreaterThanOperator") threshold += 1;
    }
  }
  if (!varName || threshold === null) return null;
  const effect = segEffects.find((e) => e.variable === varName);
  if (!effect) return null;
  let drain = 0;
  let hasNonDrain = false;
  for (const op of effect.ops) {
    if (op.kind === "compound" && op.operator === "SubtractionOperator" && op.operand !== null && op.operand > 0) {
      drain += op.operand;
    } else {
      hasNonDrain = true;
    }
  }
  if (hasNonDrain || drain === 0) return null;
  return { kind: "monotone-drain", variable: varName, drain, threshold, segmentId };
};
var detectDrainTags = (scc, graph) => {
  const members = new Set(scc);
  const tags = [];
  let hasUnconditionedLoopingOption = false;
  for (const segId of scc) {
    const seg = graph.segments[segId];
    if (!seg) continue;
    for (const entry of seg.entries) {
      if (entry.kind !== "choice-option") continue;
      if (entry.selectableIf) {
        const entryTags = collectEntryTags(entry.selectableIf, seg.effects, segId);
        if (entryTags.length === 0) return [];
        tags.push(...entryTags);
      } else {
        const loopsBack = graph.edges.some(
          (e) => e.sourceSegmentId === segId && members.has(e.targetSegmentId)
        );
        if (loopsBack) hasUnconditionedLoopingOption = true;
      }
    }
  }
  if (tags.length === 0 || hasUnconditionedLoopingOption) return [];
  return tags;
};

// ../analysis/segments/segment-analysis.ts
var BUILTINS = /* @__PURE__ */ new Set([
  "choice_randomtest",
  "choice_quicktest",
  "choice_randomscene",
  "choice_nightmode",
  "choice_saved_is_allowed",
  "choice_save_name",
  "choice_time_stamp",
  "choice_restore_purchases_allowed",
  "choice_purchased_adfree",
  "choice_is_trial",
  "choice_is_advertising_supported",
  "choice_is_web",
  "choice_is_steam",
  "choice_is_ios",
  "choice_is_android",
  "choice_is_omnibus",
  "choice_release_date",
  "choice_prerelease",
  "choice_subscribe_allowed",
  "choice_subscribed",
  "true",
  "false"
]);
var isBuiltin = (name) => BUILTINS.has(name) || name.startsWith("choice_");
var AnalysisCollector = class {
  deadBranches = [];
  icfStates = /* @__PURE__ */ new Map();
  undeclaredSets = [];
  multiReplaceViolations = [];
  seen = /* @__PURE__ */ new Set();
  knownDeclared = /* @__PURE__ */ new Set();
  filterUndeclaredSets() {
    return this.undeclaredSets.filter(
      (v) => !this.knownDeclared.has(v.variable.toLowerCase())
    );
  }
  checkSetDeclarations(cfgId, blockId, scene, block, state, statements) {
    const locallyDefined = /* @__PURE__ */ new Set();
    for (const stmtId of block.statementIds) {
      const stmt = statements[stmtId];
      if (!stmt) continue;
      if (stmt.kind === "Parameters") {
        for (const id of stmt.identifiers) {
          if (id?.value) locallyDefined.add(id.value);
        }
      }
      this.checkWrite(cfgId, blockId, stmtId, scene, stmt, state);
      this.checkReferences(cfgId, blockId, stmtId, scene, stmt, state, locallyDefined);
      this.checkMultiReplace(cfgId, blockId, stmtId, scene, stmt, state);
      if (stmt.kind === "DeclareVariable") {
        const s = stmt;
        if (s.identifier?.value) locallyDefined.add(s.identifier.value);
      }
    }
  }
  recordIcf(blockId, state, scene) {
    const value = getVariable(state, "implicit_control_flow", scene);
    if (value.kind === "constant") {
      const v = value.value;
      this.icfStates.set(
        blockId,
        typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v !== ""
      );
    }
  }
  checkMultiReplace(cfgId, blockId, stmtId, scene, stmt, state) {
    const s = stmt;
    const segments = s.parsedSegments;
    if (!segments) return;
    this.walkMultiReplaceSegments(cfgId, blockId, stmtId, scene, segments, state);
  }
  walkMultiReplaceSegments(cfgId, blockId, stmtId, scene, segments, state) {
    for (const seg of segments) {
      if (seg.kind !== "MultiReplace") continue;
      const n = seg.alternatives?.length ?? 0;
      if (n === 0) continue;
      const result = evaluateExpression(seg.selector, state, scene);
      if (result.kind === "constant") {
        const v = result.value;
        if (typeof v === "number") {
          if (v === 0) {
            this.multiReplaceViolations.push({
              cfgId,
              blockId,
              statementId: stmtId,
              scene,
              line: seg.lineNumber,
              position: seg.position,
              selectorValue: v,
              alternativeCount: n,
              kind: "zero-index"
            });
          } else if (v < 1 || v > n) {
            this.multiReplaceViolations.push({
              cfgId,
              blockId,
              statementId: stmtId,
              scene,
              line: seg.lineNumber,
              position: seg.position,
              selectorValue: v,
              alternativeCount: n,
              kind: "out-of-range"
            });
          }
        } else if (typeof v === "string" && v !== "true" && v !== "false" && isNaN(Number(v))) {
          this.multiReplaceViolations.push({
            cfgId,
            blockId,
            statementId: stmtId,
            scene,
            line: seg.lineNumber,
            position: seg.position,
            selectorValue: v,
            alternativeCount: n,
            kind: "string-selector"
          });
        }
      }
      for (const alt of seg.alternatives ?? []) {
        if (alt.segments) this.walkMultiReplaceSegments(cfgId, blockId, stmtId, scene, alt.segments, state);
      }
    }
  }
  checkWrite(cfgId, blockId, stmtId, scene, stmt, state) {
    if (stmt.kind !== "SetVariable") return;
    const effect = extractEffect(stmt);
    if (!effect.defines) return;
    const name = effect.defines.variable;
    if (isBuiltin(name)) return;
    const existing = getVariable(state, name, scene);
    if (existing.kind !== "bottom") {
      this.knownDeclared.add(name.toLowerCase());
      return;
    }
    const key = `set:${cfgId}:${stmtId}:${name}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const loc = getWriteTargetLocation(stmt);
    this.undeclaredSets.push({
      cfgId,
      blockId,
      statementId: stmtId,
      scene,
      variable: name,
      line: loc?.line ?? -1,
      position: loc?.position ?? -1,
      statementKind: stmt.kind,
      kind: "set"
    });
  }
  checkReferences(cfgId, blockId, stmtId, scene, stmt, state, locallyDefined) {
    const refs = collectRefsWithLocations(stmt);
    for (const ref of refs) {
      if (isBuiltin(ref.name)) continue;
      if (locallyDefined.has(ref.name)) continue;
      const writeEffect = extractEffect(stmt);
      if (writeEffect.defines && ref.name === writeEffect.defines.variable) continue;
      const existing = getVariable(state, ref.name, scene);
      if (existing.kind !== "bottom") {
        this.knownDeclared.add(ref.name.toLowerCase());
        continue;
      }
      const key = `ref:${cfgId}:${stmtId}:${ref.name}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.undeclaredSets.push({
        cfgId,
        blockId,
        statementId: stmtId,
        scene,
        variable: ref.name,
        line: ref.line,
        position: ref.position,
        statementKind: stmt.kind,
        kind: "reference"
      });
    }
  }
};
var evaluateEdgeCondition = (edge, state, scene, statements) => {
  const stmtId = edge.metadata?.conditionStatementId ?? edge.metadata?.choiceConditionId;
  if (!stmtId) return null;
  const stmt = statements[stmtId];
  if (!stmt) return null;
  const expr = stmt.expression ?? stmt.selectableIf;
  if (!expr) return null;
  return evaluateExpression(expr, state, scene);
};
var isTruthy3 = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "";
};
var isProvablyFalse = (value) => value.kind === "constant" && !isTruthy3(value.value);
var isProvablyTrue = (value) => value.kind === "constant" && isTruthy3(value.value);
var isControlFlowExit = (exitType) => exitType === "Goto" || exitType === "Finish" || exitType === "GotoScene" || exitType === "Ending" || exitType === "Return";
var extractEqualityNarrow = (edge, statements) => {
  const stmtId = edge.metadata?.conditionStatementId;
  if (!stmtId) return null;
  const stmt = statements[stmtId];
  if (!stmt) return null;
  const expr = stmt.expression;
  if (!expr || !expr.operator || !expr.left || !expr.right) return null;
  if (expr.operator.type !== "EqualityOperator") return null;
  const leftToken = expr.left?.token;
  const rightToken = expr.right?.value;
  if (leftToken?.type === "Identifier" && rightToken) {
    const litType = rightToken.type;
    if (litType === "StringLiteral" || litType === "NumberLiteral" || litType === "BooleanLiteral") {
      return { variable: leftToken.value.toLowerCase(), value: rightToken.value };
    }
  }
  const rightIdToken = expr.right?.token;
  const leftLit = expr.left?.value;
  if (rightIdToken?.type === "Identifier" && leftLit) {
    const litType = leftLit.type;
    if (litType === "StringLiteral" || litType === "NumberLiteral" || litType === "BooleanLiteral") {
      return { variable: rightIdToken.value.toLowerCase(), value: leftLit.value };
    }
  }
  return null;
};
var narrowVariable = (globals, temps, varName, excludeValue, scene) => {
  const idx = globals.index.get(varName);
  if (idx !== void 0) {
    const current = globals.values[idx];
    const narrowed = excludeFromValue(current, excludeValue);
    if (narrowed !== current) globals.set(varName, narrowed);
    return;
  }
  const sv = temps.get(scene);
  if (sv) {
    const current = sv.get(varName);
    if (current) {
      const narrowed = excludeFromValue(current, excludeValue);
      if (narrowed !== current) sv.set(varName, narrowed);
    }
  }
};
var excludeFromValue = (value, exclude) => {
  if (value.kind === "constant") {
    return value.value === exclude ? bottom : value;
  }
  if (value.kind === "set") {
    const filtered = value.values.filter((v) => v !== exclude);
    if (filtered.length === value.values.length) return value;
    return set(filtered, value.hasUserInput);
  }
  return value;
};
var walkCfgBlocksWithAnalysis = (layout, state, opts) => {
  const plan = layout.walkPlan;
  if (plan.length === 0) return;
  const { cfgId, scene, collector, statements, blockIndex, allowedBlocks, onBlock } = opts;
  const globals = state.globals;
  const temps = state.temps;
  const savedGlobals = new Array(layout.maxSlots);
  const savedGlobalHashes = new Array(layout.maxSlots);
  const savedTemps = new Array(layout.maxSlots);
  const savedTempHashes = new Array(layout.maxSlots);
  const joinedGlobals = new Array(layout.maxSlots);
  const joinedTemps = new Array(layout.maxSlots);
  const armDead = new Array(layout.maxSlots).fill(false);
  const armDeadReason = new Array(layout.maxSlots);
  const armDeadCondStmt = new Array(layout.maxSlots);
  let deadDepth = 0;
  const priorConditions = new Array(layout.maxSlots);
  const armExited = new Array(layout.maxSlots).fill(false);
  const priorNarrowings = new Array(layout.maxSlots);
  const slotStack = [];
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    switch (item.kind) {
      case "block": {
        if (allowedBlocks && !allowedBlocks.has(item.blockId)) break;
        const block = blockIndex[item.blockId];
        if (!block) break;
        const isDead = deadDepth > 0;
        if (isDead) {
          const activeSlot = slotStack[slotStack.length - 1];
          if (activeSlot !== void 0 && armDead[activeSlot] && armDeadReason[activeSlot]) {
            collector.deadBranches.push({
              cfgId,
              blockId: item.blockId,
              scene,
              reason: armDeadReason[activeSlot],
              conditionStatementId: armDeadCondStmt[activeSlot]
            });
          }
        } else {
          onBlock?.(item.blockId);
          collector.recordIcf(item.blockId, state, scene);
          collector.checkSetDeclarations(cfgId, item.blockId, scene, block, state, statements);
        }
        applyBlockStatements(item.blockId, state, scene, blockIndex, statements);
        if (!isDead && slotStack.length > 0) {
          const activeSlot = slotStack[slotStack.length - 1];
          armExited[activeSlot] = isControlFlowExit(block.exitType);
        }
        break;
      }
      case "branch-start": {
        const slot = item.slot;
        slotStack.push(slot);
        savedGlobalHashes[slot] = globals.xorHash;
        savedGlobals[slot] = globals.shareValues();
        savedTempHashes[slot] = temps.xorHash;
        savedTemps[slot] = temps.shareValues();
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        priorConditions[slot] = [];
        armExited[slot] = false;
        priorNarrowings[slot] = [];
        if (deadDepth === 0) {
          const edge = item.edge;
          if (isConditionalBranch(edge.kind) || isChoiceOptionEdge(edge.kind)) {
            const condResult = evaluateEdgeCondition(edge, state, scene, statements);
            if (condResult) {
              priorConditions[slot].push(condResult);
              if (isProvablyFalse(condResult)) {
                armDead[slot] = true;
                armDeadReason[slot] = edge.metadata?.choiceConditionKind === "selectable_if" ? "selectable-if-false" : "condition-false";
                armDeadCondStmt[slot] = edge.metadata?.conditionStatementId ?? edge.metadata?.choiceConditionId;
                deadDepth++;
              }
            }
            const narrow = extractEqualityNarrow(edge, statements);
            if (narrow) priorNarrowings[slot].push(narrow);
          }
        }
        break;
      }
      case "arm-boundary": {
        const slot = item.slot;
        if (!armExited[slot]) {
          if (joinedGlobals[slot] === null) {
            joinedGlobals[slot] = globals.cloneValues();
            joinedTemps[slot] = temps.cloneValues();
          } else {
            const jg = joinedGlobals[slot];
            const gv = globals.values;
            for (let j = 0; j < jg.length; j++) {
              if (jg[j] !== gv[j]) jg[j] = join(jg[j], gv[j]);
            }
            const jt = joinedTemps[slot];
            const tv = temps.values;
            for (let j = 0; j < jt.length; j++) {
              if (jt[j] !== tv[j]) jt[j] = join(jt[j], tv[j]);
            }
          }
        }
        globals.adoptValues(savedGlobals[slot], savedGlobalHashes[slot]);
        temps.adoptValues(savedTemps[slot], savedTempHashes[slot]);
        if (armDead[slot]) {
          deadDepth--;
          armDead[slot] = false;
          armDeadReason[slot] = void 0;
          armDeadCondStmt[slot] = void 0;
        }
        armExited[slot] = false;
        if (deadDepth === 0) {
          const edge = item.edge;
          if (edge.kind === "ElseBranch" || edge.kind === "IfFallThrough") {
            for (const n of priorNarrowings[slot]) {
              narrowVariable(globals, temps, n.variable, n.value, scene);
            }
            const allPriorTrue = priorConditions[slot].length > 0 && priorConditions[slot].every((c) => isProvablyTrue(c));
            if (allPriorTrue) {
              armDead[slot] = true;
              armDeadReason[slot] = "condition-true-elsewhere";
              armDeadCondStmt[slot] = edge.metadata?.conditionStatementId;
              deadDepth++;
            }
          } else if (isConditionalBranch(edge.kind) || isChoiceOptionEdge(edge.kind)) {
            const condResult = evaluateEdgeCondition(edge, state, scene, statements);
            if (condResult) {
              priorConditions[slot].push(condResult);
              if (isProvablyFalse(condResult)) {
                armDead[slot] = true;
                armDeadReason[slot] = edge.metadata?.choiceConditionKind === "selectable_if" ? "selectable-if-false" : "condition-false";
                armDeadCondStmt[slot] = edge.metadata?.conditionStatementId ?? edge.metadata?.choiceConditionId;
                deadDepth++;
              }
            }
            const narrow = extractEqualityNarrow(edge, statements);
            if (narrow) priorNarrowings[slot].push(narrow);
          }
        }
        break;
      }
      case "branch-end": {
        const slot = item.slot;
        slotStack.pop();
        if (!armExited[slot]) {
          if (joinedGlobals[slot] === null) {
            joinedGlobals[slot] = globals.cloneValues();
            joinedTemps[slot] = temps.cloneValues();
          } else {
            const jg = joinedGlobals[slot];
            const gv = globals.values;
            for (let j = 0; j < jg.length; j++) {
              if (jg[j] !== gv[j]) jg[j] = join(jg[j], gv[j]);
            }
            const jt = joinedTemps[slot];
            const tv = temps.values;
            for (let j = 0; j < jt.length; j++) {
              if (jt[j] !== tv[j]) jt[j] = join(jt[j], tv[j]);
            }
          }
        }
        if (joinedGlobals[slot] !== null) {
          globals.takeValues(joinedGlobals[slot]);
          temps.takeValues(joinedTemps[slot]);
        }
        savedGlobals[slot] = null;
        savedTemps[slot] = null;
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        armExited[slot] = false;
        if (armDead[slot]) {
          deadDepth--;
          armDead[slot] = false;
          armDeadReason[slot] = void 0;
          armDeadCondStmt[slot] = void 0;
        }
        break;
      }
    }
  }
};
var collectIdentifierLocations = (expr, out) => {
  if (!expr) return;
  if (expr.token?.type === "Identifier" && expr.token.value) {
    out.push({ name: expr.token.value, line: expr.token.lineNumber, position: expr.token.position });
    return;
  }
  if (expr.identifier?.value) {
    out.push({ name: expr.identifier.value, line: expr.identifier.lineNumber, position: expr.identifier.position });
  }
  if (expr.left) collectIdentifierLocations(expr.left, out);
  if (expr.right) collectIdentifierLocations(expr.right, out);
  if (expr.value && expr.operator) collectIdentifierLocations(expr.value, out);
  if (expr.expression && !expr.identifier) collectIdentifierLocations(expr.expression, out);
  if (expr.selector) collectIdentifierLocations(expr.selector, out);
};
var collectRefsWithLocations = (stmt) => {
  const exprs = extractExpressions(stmt);
  const out = [];
  for (const expr of exprs) {
    collectIdentifierLocations(expr, out);
  }
  return out;
};
var getWriteTargetLocation = (stmt) => {
  const s = stmt;
  if (s.assignment) {
    const expr = s.expression;
    if (expr?.token?.type === "Identifier" && expr.token.value) {
      return { name: expr.token.value, line: expr.token.lineNumber, position: expr.token.position };
    }
  } else if (s.expression?.left?.token?.type === "Identifier") {
    const tok = s.expression.left.token;
    return { name: tok.value, line: tok.lineNumber, position: tok.position };
  }
  return null;
};
var doesSubgraphExit = (blockId, cfg, blockIndex, visited) => {
  if (visited.has(blockId)) return false;
  visited.add(blockId);
  const block = blockIndex[blockId];
  if (!block) return false;
  if (isControlFlowExit(block.exitType)) return true;
  if (block.exitType === "Choice") {
    const optEdges = cfg.edges.filter(
      (e) => e.sourceBlockId === blockId && isChoiceOptionEdge(e.kind)
    );
    return optEdges.length > 0 && optEdges.every(
      (e) => doesSubgraphExit(e.targetBlockId, cfg, blockIndex, visited)
    );
  }
  if (block.exitType === "Branch") {
    const branchEdges = cfg.edges.filter(
      (e) => e.sourceBlockId === blockId && (e.kind === "IfBranch" || e.kind === "ElseIfBranch" || e.kind === "ElseBranch")
    );
    const hasElse = branchEdges.some((e) => e.kind === "ElseBranch");
    if (hasElse) {
      return branchEdges.every(
        (e) => doesSubgraphExit(e.targetBlockId, cfg, blockIndex, visited)
      );
    }
  }
  if (block.exitType === "FallThrough") {
    const ftEdge = cfg.edges.find(
      (e) => e.sourceBlockId === blockId && e.kind === "FallThrough" && !e.metadata.implicitControlFlow
    );
    if (ftEdge) return doesSubgraphExit(ftEdge.targetBlockId, cfg, blockIndex, visited);
  }
  return false;
};
var isContinuationUnreachable = (blockId, cfg, blockIndex) => {
  const incoming = cfg.edges.filter((e) => e.targetBlockId === blockId);
  if (incoming.length === 0) return true;
  return incoming.every((e) => {
    const src = blockIndex[e.sourceBlockId];
    if (!src) return false;
    if (src.exitType === "Choice") return true;
    if (src.exitType === "FallThrough" && src.statementIds.length === 0) {
      return isContinuationUnreachable(e.sourceBlockId, cfg, blockIndex);
    }
    if (e.kind === "IfFallThrough" && src.exitType === "Branch") {
      const ifBranch = cfg.edges.find(
        (be) => be.sourceBlockId === e.sourceBlockId && be.kind === "IfBranch"
      );
      if (ifBranch && doesSubgraphExit(ifBranch.targetBlockId, cfg, blockIndex, /* @__PURE__ */ new Set())) {
        return isContinuationUnreachable(e.sourceBlockId, cfg, blockIndex);
      }
    }
    return false;
  });
};
var isAllOptionsFallthrough = (blockId, cfg, blockIndex) => {
  const incoming = cfg.edges.filter((e) => e.targetBlockId === blockId);
  let choiceBlockId = null;
  for (const e of incoming) {
    let current = e.sourceBlockId;
    for (let i = 0; i < 10; i++) {
      const b = blockIndex[current];
      if (!b) break;
      if (b.entryType === "ChoiceOptionEntry") {
        const optEdge = cfg.edges.find(
          (oe) => oe.targetBlockId === current && isChoiceOptionEdge(oe.kind)
        );
        if (optEdge) {
          const src = blockIndex[optEdge.sourceBlockId];
          if (src?.exitType === "Choice") {
            choiceBlockId = optEdge.sourceBlockId;
            break;
          }
        }
        break;
      }
      if (b.exitType === "FallThrough" && b.statementIds.length === 0) {
        const pred = cfg.edges.find((pe) => pe.targetBlockId === current);
        if (!pred) break;
        current = pred.sourceBlockId;
        continue;
      }
      break;
    }
    if (choiceBlockId) break;
  }
  if (!choiceBlockId) return false;
  const optionEdges = cfg.edges.filter(
    (e) => e.sourceBlockId === choiceBlockId && isChoiceOptionEdge(e.kind)
  );
  return optionEdges.length > 0 && optionEdges.every(
    (e) => !doesSubgraphExit(e.targetBlockId, cfg, blockIndex, /* @__PURE__ */ new Set())
  );
};
var checkControlFlowViolations = (linked, blockIndex, icfStates, deadBlocks) => {
  const violations = [];
  for (const cfg of Object.values(linked.cfgs)) {
    const seen = /* @__PURE__ */ new Set();
    for (const edge of cfg.edges) {
      if (edge.kind !== "FallThrough") continue;
      if (!edge.metadata.implicitControlFlow) continue;
      if (deadBlocks?.has(edge.sourceBlockId)) continue;
      const icfTrue = icfStates.get(edge.sourceBlockId) ?? false;
      if (!icfTrue && !seen.has(edge.sourceBlockId)) {
        seen.add(edge.sourceBlockId);
        if (isContinuationUnreachable(edge.sourceBlockId, cfg, blockIndex)) continue;
        if (isAllOptionsFallthrough(edge.sourceBlockId, cfg, blockIndex)) continue;
        const block = blockIndex[edge.sourceBlockId];
        let displayBlockId;
        if (block && block.statementIds.length === 0) {
          let targetId = edge.sourceBlockId;
          for (let i = 0; i < 5; i++) {
            const pred = cfg.edges.find((e) => e.targetBlockId === targetId);
            if (!pred) break;
            const predBlock = blockIndex[pred.sourceBlockId];
            if (predBlock && predBlock.statementIds.length > 0) {
              displayBlockId = pred.sourceBlockId;
              break;
            }
            targetId = pred.sourceBlockId;
          }
        }
        violations.push({
          cfgId: cfg.id,
          blockId: edge.sourceBlockId,
          scene: cfg.scene,
          kind: "choice-fallthrough",
          displayBlockId
        });
      }
    }
    for (const exit of cfg.exits) {
      if (exit.kind !== "SceneExit") continue;
      const block = blockIndex[exit.blockId];
      if (!block || block.exitType !== "ImplicitEnd") continue;
      if (deadBlocks?.has(exit.blockId)) continue;
      const icfTrue = icfStates.get(exit.blockId) ?? false;
      if (!icfTrue) {
        violations.push({ cfgId: cfg.id, blockId: exit.blockId, scene: cfg.scene, kind: "implicit-end" });
      }
    }
  }
  return violations;
};

// ../analysis/segments/segment-dataflow.ts
var buildSeedState = (linked, statements) => {
  const tempState = emptyState();
  for (const cfg of Object.values(linked.cfgs)) {
    if (!tempState.temps.has(cfg.scene)) {
      tempState.temps.set(cfg.scene, /* @__PURE__ */ new Map());
    }
  }
  for (const stmt of Object.values(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const effect = extractEffect(stmt);
    if (!effect.defines || effect.defines.scope !== "Global") continue;
    const value = effect.defines.valueExpression ? evaluateExpression(effect.defines.valueExpression, tempState, "") : { kind: "constant", value: false };
    tempState.globals.set(effect.defines.variable.toLowerCase(), value);
  }
  const globalIndex = /* @__PURE__ */ new Map();
  const globalNames = [];
  for (const [name] of tempState.globals) {
    globalIndex.set(name, globalNames.length);
    globalNames.push(name);
  }
  const indexedGlobals = new IndexedMap(globalIndex, globalNames);
  for (const [name, value] of tempState.globals) {
    indexedGlobals.set(name, value);
  }
  const indexedTemps = new IndexedTempMap();
  for (const [scene] of tempState.temps) {
    indexedTemps.addScene(scene);
  }
  return {
    parent: null,
    globals: indexedGlobals,
    temps: indexedTemps
  };
};
var applyGosubParams = (state, binding, linked, blockIndex, statements) => {
  const targetCfg = linked.cfgs[binding.targetCfgId];
  if (!targetCfg) return;
  const entryBlock = blockIndex[targetCfg.entryBlockId];
  const paramNames = entryBlock?.parameterNames;
  if (!paramNames?.length) return;
  const callerBlock = blockIndex[binding.callerBlockId];
  if (!callerBlock?.statementIds.length) return;
  const lastStmtId = callerBlock.statementIds[callerBlock.statementIds.length - 1];
  const stmt = statements[lastStmtId];
  if (!stmt || stmt.kind !== "GoSub" && stmt.kind !== "GoSubScene") return;
  const gosubStmt = stmt;
  if (!gosubStmt.args?.length) return;
  const callerCfg = linked.cfgs[binding.callerCfgId];
  const callerScene = callerCfg?.scene ?? "";
  const count = Math.min(gosubStmt.args.length, paramNames.length);
  for (let i = 0; i < count; i++) {
    const argValue = evaluateExpression(gosubStmt.args[i], state, callerScene);
    setVariableMut(state, paramNames[i], argValue, "Temporary", targetCfg.scene);
  }
};
var walkSegmentBlocks = (layout, state, scene, blockIndex, statements, allowedBlocks, onBlock) => {
  const plan = layout.walkPlan;
  if (plan.length === 0) return;
  const globals = state.globals;
  const temps = state.temps;
  const savedGlobals = new Array(layout.maxSlots);
  const savedGlobalHashes = new Array(layout.maxSlots);
  const savedTemps = new Array(layout.maxSlots);
  const savedTempHashes = new Array(layout.maxSlots);
  const joinedGlobals = new Array(layout.maxSlots);
  const joinedTemps = new Array(layout.maxSlots);
  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    switch (item.kind) {
      case "block":
        if (allowedBlocks.has(item.blockId)) {
          onBlock?.(item.blockId);
          applyBlockStatements(item.blockId, state, scene, blockIndex, statements);
        }
        break;
      case "branch-start":
        savedGlobalHashes[item.slot] = globals.xorHash;
        savedGlobals[item.slot] = globals.shareValues();
        savedTempHashes[item.slot] = temps.xorHash;
        savedTemps[item.slot] = temps.shareValues();
        joinedGlobals[item.slot] = null;
        joinedTemps[item.slot] = null;
        break;
      case "arm-boundary": {
        const slot = item.slot;
        if (joinedGlobals[slot] === null) {
          joinedGlobals[slot] = globals.cloneValues();
          joinedTemps[slot] = temps.cloneValues();
        } else {
          const jg = joinedGlobals[slot];
          const gv = globals.values;
          for (let j = 0; j < jg.length; j++) {
            if (jg[j] !== gv[j]) jg[j] = join(jg[j], gv[j]);
          }
          const jt = joinedTemps[slot];
          const tv = temps.values;
          for (let j = 0; j < jt.length; j++) {
            if (jt[j] !== tv[j]) jt[j] = join(jt[j], tv[j]);
          }
        }
        globals.adoptValues(savedGlobals[slot], savedGlobalHashes[slot]);
        temps.adoptValues(savedTemps[slot], savedTempHashes[slot]);
        break;
      }
      case "branch-end": {
        const slot = item.slot;
        if (joinedGlobals[slot] === null) {
          joinedGlobals[slot] = globals.cloneValues();
          joinedTemps[slot] = temps.cloneValues();
        } else {
          const jg = joinedGlobals[slot];
          const gv = globals.values;
          for (let j = 0; j < jg.length; j++) {
            if (jg[j] !== gv[j]) jg[j] = join(jg[j], gv[j]);
          }
          const jt = joinedTemps[slot];
          const tv = temps.values;
          for (let j = 0; j < jt.length; j++) {
            if (jt[j] !== tv[j]) jt[j] = join(jt[j], tv[j]);
          }
        }
        globals.takeValues(joinedGlobals[slot]);
        temps.takeValues(joinedTemps[slot]);
        savedGlobals[slot] = null;
        savedTemps[slot] = null;
        joinedGlobals[slot] = null;
        joinedTemps[slot] = null;
        break;
      }
    }
  }
};
var applySegmentTransfer = (state, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg, cfgEntrySnap, onBlock) => {
  const visitedCfgs = /* @__PURE__ */ new Set();
  const segBlockSet = new Set(segment.blockIds);
  const cfgBlockSets = /* @__PURE__ */ new Map();
  for (const blockId of segment.blockIds) {
    const cfgId = globalBlockToCfg.get(blockId);
    if (cfgId) getOrSet(cfgBlockSets, cfgId, () => /* @__PURE__ */ new Set()).add(blockId);
  }
  const owningCfg = linked.cfgs[segment.cfgId];
  if (owningCfg) {
    visitedCfgs.add(segment.cfgId);
    cfgEntrySnap?.(segment.cfgId);
    const layout = cfgLayouts.get(segment.cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkSegmentBlocks(layout, state, owningCfg.scene, blockIndex, statements, segBlockSet, onBlock);
    }
  }
  for (const binding of segment.gosubBindings) {
    if (visitedCfgs.has(binding.targetCfgId)) continue;
    visitedCfgs.add(binding.targetCfgId);
    applyGosubParams(state, binding, linked, blockIndex, statements);
    const targetCfg = linked.cfgs[binding.targetCfgId];
    if (!targetCfg) continue;
    cfgEntrySnap?.(binding.targetCfgId);
    const layout = cfgLayouts.get(binding.targetCfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkCfgBlocks(layout, state, targetCfg.scene, blockIndex, statements, onBlock);
    }
    if (binding.continuationCfgId && !visitedCfgs.has(binding.continuationCfgId)) {
      visitedCfgs.add(binding.continuationCfgId);
      const contCfg = linked.cfgs[binding.continuationCfgId];
      if (contCfg) {
        cfgEntrySnap?.(binding.continuationCfgId);
        const contLayout = cfgLayouts.get(binding.continuationCfgId);
        if (contLayout && contLayout.walkPlan.length > 0) {
          walkCfgBlocks(contLayout, state, contCfg.scene, blockIndex, statements, onBlock);
        }
      }
    }
  }
  for (const [cfgId, blocks] of cfgBlockSets) {
    if (visitedCfgs.has(cfgId)) continue;
    visitedCfgs.add(cfgId);
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    cfgEntrySnap?.(cfgId);
    const layout = cfgLayouts.get(cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkSegmentBlocks(layout, state, cfg.scene, blockIndex, statements, blocks, onBlock);
    }
  }
};
var hashState = (globals, temps) => fnvMixInt(globals.xorHash, temps.xorHash);
var serializeFromIndexed = (globals, temps, storedGlobals, storedTemps) => {
  const gObj = {};
  const names = globals.names;
  for (let i = 0; i < names.length && i < storedGlobals.length; i++) {
    gObj[names[i]] = storedGlobals[i] ?? bottom;
  }
  const tObj = {};
  for (const [scene, sv] of temps) {
    const sceneObj = {};
    for (const [name, idx] of sv._indices) {
      const val = idx < storedTemps.length ? storedTemps[idx] : bottom;
      if (val && val.kind !== "bottom") sceneObj[name] = val;
    }
    if (Object.keys(sceneObj).length > 0) tObj[scene] = sceneObj;
  }
  return { globals: gObj, temps: tObj };
};
var computeDrainValues = (initial, tags) => {
  const drainTags = tags.filter((t) => t.kind === "monotone-drain");
  if (drainTags.length === 0) return /* @__PURE__ */ new Set([initial]);
  const reachable = /* @__PURE__ */ new Set();
  const queue = [initial];
  while (queue.length > 0) {
    const val = queue.pop();
    if (reachable.has(val)) continue;
    reachable.add(val);
    for (const tag of drainTags) {
      if (val >= tag.threshold) {
        const next = val - tag.drain;
        if (!reachable.has(next)) queue.push(next);
      }
    }
  }
  return reachable;
};
var applyDrainOverrides = (loop2, graph, segEntryHash, segExitHash, storedStates, globals, temps, snap, loadSnapshot) => {
  const drainVars = /* @__PURE__ */ new Set();
  const boolVars = /* @__PURE__ */ new Set();
  for (const tag of loop2.drainTags) {
    if (tag.kind === "monotone-drain") drainVars.add(tag.variable);
    else if (tag.kind === "boolean-flip") boolVars.add(tag.variable);
  }
  const members = new Set(loop2.memberIds);
  const externalExitHashes = [];
  for (const edge of graph.edges) {
    if (members.has(edge.targetSegmentId) && !members.has(edge.sourceSegmentId)) {
      const h = segExitHash.get(edge.sourceSegmentId);
      if (h !== void 0) externalExitHashes.push(h);
    }
  }
  if (members.has(graph.entrySegmentId)) {
    const h = segEntryHash.get(graph.entrySegmentId);
    if (h !== void 0) externalExitHashes.push(h);
  }
  if (externalExitHashes.length === 0) return;
  const varOverrides = /* @__PURE__ */ new Map();
  for (const varName of drainVars) {
    const idx = globals.index.get(varName);
    if (idx === void 0) continue;
    let joinedVal = bottom;
    for (const h of externalExitHashes) {
      const state = storedStates.get(h);
      if (!state) continue;
      const val = state.globals[idx];
      if (val) joinedVal = join(joinedVal, val);
    }
    if (joinedVal.kind === "constant" && typeof joinedVal.value === "number") {
      const reachable = computeDrainValues(joinedVal.value, loop2.drainTags);
      varOverrides.set(varName, set([...reachable]));
    } else if (joinedVal.kind === "set" && joinedVal.values.every((v) => typeof v === "number")) {
      const allReachable = /* @__PURE__ */ new Set();
      for (const v of joinedVal.values) {
        for (const r of computeDrainValues(v, loop2.drainTags)) allReachable.add(r);
      }
      varOverrides.set(varName, set([...allReachable]));
    }
  }
  for (const varName of boolVars) {
    varOverrides.set(varName, set([true, false]));
  }
  if (varOverrides.size === 0) return;
  const patchState = (hashMap, segId) => {
    const h = hashMap.get(segId);
    if (h === void 0) return;
    loadSnapshot(h);
    for (const [varName, overrideVal] of varOverrides) {
      globals.set(varName, overrideVal);
    }
    hashMap.set(segId, snap());
  };
  for (const memberId of loop2.memberIds) {
    patchState(segEntryHash, memberId);
    patchState(segExitHash, memberId);
  }
};
var computeBlockDelta = (globals, temps, refStored) => {
  if (globals.xorHash === refStored.globalsHash && temps.xorHash === refStored.tempsHash) return null;
  const curGlobals = globals.values;
  const gNames = globals.names;
  let gDelta = null;
  if (globals.xorHash !== refStored.globalsHash) {
    const refGlobals = refStored.globals;
    for (let i = 0; i < gNames.length; i++) {
      if (curGlobals[i] !== refGlobals[i]) {
        if (!gDelta) gDelta = {};
        gDelta[gNames[i]] = curGlobals[i];
      }
    }
  }
  let tDelta = null;
  if (temps.xorHash !== refStored.tempsHash) {
    const curTemps = temps.values;
    const refTemps = refStored.temps;
    for (const [scene, sv] of temps) {
      for (const [name, idx] of sv._indices) {
        if (idx < curTemps.length && idx < refTemps.length && curTemps[idx] !== refTemps[idx]) {
          if (!tDelta) tDelta = {};
          if (!tDelta[scene]) tDelta[scene] = {};
          tDelta[scene][name] = curTemps[idx];
        }
      }
    }
  }
  if (!gDelta && !tDelta) return null;
  return { globals: gDelta ?? {}, temps: tDelta ?? {} };
};
var solveSegmentDataflow = (segmentGraph, linked, blockIndex, statements) => {
  const t0 = performance.now();
  const live = buildSeedState(linked, statements);
  const globals = live.globals;
  const temps = live.temps;
  const tSeed = performance.now();
  const cfgLayouts = /* @__PURE__ */ new Map();
  const globalBlockToCfg = /* @__PURE__ */ new Map();
  for (const [cfgId, cfg] of Object.entries(linked.cfgs)) {
    cfgLayouts.set(cfgId, buildCfgLayout(cfg));
    for (const blockId of Object.keys(cfg.blocks)) {
      globalBlockToCfg.set(blockId, cfgId);
    }
  }
  const storedStates = /* @__PURE__ */ new Map();
  const segEntryHash = /* @__PURE__ */ new Map();
  const segExitHash = /* @__PURE__ */ new Map();
  const edgesByTarget = /* @__PURE__ */ new Map();
  for (const edge of segmentGraph.edges) {
    getOrSet(edgesByTarget, edge.targetSegmentId, () => []).push(edge);
  }
  const snap = () => {
    const h = hashState(globals, temps);
    if (!storedStates.has(h)) {
      storedStates.set(h, {
        globals: globals.shareValues(),
        globalsHash: globals.xorHash,
        temps: temps.shareValues(),
        tempsHash: temps.xorHash
      });
    }
    return h;
  };
  const loadSnapshot = (id) => {
    const s = storedStates.get(id);
    globals.adoptValues(s.globals, s.globalsHash);
    temps.adoptValues(s.temps, s.tempsHash);
  };
  const joinSnapshot = (id) => {
    const s = storedStates.get(id);
    if (s.globalsHash !== globals.xorHash) globals.joinValues(s.globals);
    if (s.tempsHash !== temps.xorHash) temps.joinValues(s.temps);
  };
  const tLayout = performance.now();
  const segmentLoops = analyseSegmentLoops(segmentGraph);
  for (const segId of segmentLoops.acyclicOrder) {
    const segment = segmentGraph.segments[segId];
    if (!segment) continue;
    applySegmentTransfer(live, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg);
  }
  globals.clear();
  temps.clearAllValues();
  const tempState = emptyState();
  for (const stmt of Object.values(statements)) {
    if (stmt.kind !== "DeclareVariable") continue;
    const effect = extractEffect(stmt);
    if (!effect.defines || effect.defines.scope !== "Global") continue;
    const value = effect.defines.valueExpression ? evaluateExpression(effect.defines.valueExpression, tempState, "") : { kind: "constant", value: false };
    globals.set(effect.defines.variable.toLowerCase(), value);
  }
  const seedHash = snap();
  for (let i = 0; i < globals.names.length; i++) {
    globals.set(globals.names[i], top);
  }
  for (const [, sv] of temps) {
    for (const [name] of sv._indices) {
      sv.set(name, top);
    }
  }
  const topHash = snap();
  loadSnapshot(seedHash);
  const blockDeltas = /* @__PURE__ */ new Map();
  const blockToSegment = /* @__PURE__ */ new Map();
  const cfgEntryHashes = /* @__PURE__ */ new Map();
  const cfgEntrySnapFn = (cfgId) => {
    const h = snap();
    const prev = cfgEntryHashes.get(cfgId);
    if (prev === void 0) {
      cfgEntryHashes.set(cfgId, h);
    } else if (prev !== h) {
      loadSnapshot(prev);
      joinSnapshot(h);
      cfgEntryHashes.set(cfgId, snap());
      loadSnapshot(h);
    }
  };
  let captureEntryStored;
  const blockDeltaCb = (blockId) => {
    const delta = computeBlockDelta(globals, temps, captureEntryStored);
    if (delta) blockDeltas.set(blockId, delta);
  };
  const processSegment = (segId, cfgEntryCb, onBlockCb) => {
    const segment = segmentGraph.segments[segId];
    if (!segment) return false;
    const inEdges = edgesByTarget.get(segId) ?? [];
    let loaded = false;
    if (segId === segmentGraph.entrySegmentId) {
      loadSnapshot(seedHash);
      loaded = true;
    }
    for (const edge of inEdges) {
      const predExitId = segExitHash.get(edge.sourceSegmentId);
      if (predExitId === void 0) continue;
      if (!loaded) {
        loadSnapshot(predExitId);
        loaded = true;
      } else joinSnapshot(predExitId);
    }
    if (!loaded) return false;
    const newEntryHash = snap();
    const prevEntryHash = segEntryHash.get(segId);
    if (prevEntryHash === newEntryHash) return false;
    segEntryHash.set(segId, newEntryHash);
    applySegmentTransfer(live, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg, cfgEntryCb, onBlockCb);
    segExitHash.set(segId, snap());
    return true;
  };
  const captureSegment = (segId) => {
    const segment = segmentGraph.segments[segId];
    if (!segment) return;
    const entryId = segEntryHash.get(segId);
    if (entryId === void 0) return;
    for (const blockId of segment.blockIds) blockToSegment.set(blockId, segId);
    captureEntryStored = storedStates.get(entryId);
    loadSnapshot(entryId);
    applySegmentTransfer(live, segment, linked, blockIndex, statements, cfgLayouts, globalBlockToCfg, cfgEntrySnapFn, blockDeltaCb);
  };
  let totalIterations = 0;
  let widenedSccs = 0;
  const processedLoops = /* @__PURE__ */ new Set();
  for (const segId of segmentLoops.acyclicOrder) {
    const loop2 = segmentLoops.segmentToLoop.get(segId);
    if (!loop2) {
      const segment = segmentGraph.segments[segId];
      if (segment) for (const blockId of segment.blockIds) blockToSegment.set(blockId, segId);
      captureEntryStored = null;
      processSegment(segId, cfgEntrySnapFn, (blockId) => {
        if (!captureEntryStored) captureEntryStored = storedStates.get(segEntryHash.get(segId));
        blockDeltaCb(blockId);
      });
      totalIterations++;
      continue;
    }
    if (processedLoops.has(loop2)) continue;
    processedLoops.add(loop2);
    const cap = loop2.iterCap;
    let sccIter = 0;
    let sccChanged = true;
    while (sccChanged && sccIter < cap) {
      sccChanged = false;
      sccIter++;
      totalIterations++;
      for (const memberId of loop2.memberIds) {
        if (processSegment(memberId)) sccChanged = true;
      }
    }
    if (sccIter >= cap && sccChanged) {
      widenedSccs++;
      for (const memberId of loop2.memberIds) {
        if (segExitHash.has(memberId)) segExitHash.set(memberId, topHash);
      }
    }
    if (loop2.drainTags.length > 0) {
      applyDrainOverrides(loop2, segmentGraph, segEntryHash, segExitHash, storedStates, globals, temps, snap, loadSnapshot);
    }
    for (const memberId of loop2.memberIds) {
      captureSegment(memberId);
    }
  }
  const tSolve = performance.now();
  const serializedCache = /* @__PURE__ */ new Map();
  const getOrSerialize = (h) => {
    let s = serializedCache.get(h);
    if (s) return s;
    const stored = storedStates.get(h);
    s = serializeFromIndexed(globals, temps, stored.globals, stored.temps);
    serializedCache.set(h, s);
    return s;
  };
  const segmentStates = /* @__PURE__ */ new Map();
  for (const segId of Object.keys(segmentGraph.segments)) {
    const entryId = segEntryHash.get(segId);
    const exitId = segExitHash.get(segId);
    if (entryId !== void 0 && exitId !== void 0) {
      segmentStates.set(segId, { entry: getOrSerialize(entryId), exit: getOrSerialize(exitId) });
    }
  }
  const tSegSerialize = performance.now();
  if (linked.statsCfgIds.length > 0) {
    const allExitHashes = new Set(segExitHash.values());
    let loaded = false;
    for (const h of allExitHashes) {
      if (!loaded) {
        loadSnapshot(h);
        loaded = true;
      } else joinSnapshot(h);
    }
    if (loaded) {
      const statsEntryHash = snap();
      const statsSyntheticSegId = "__stats__";
      for (const statsCfgId of linked.statsCfgIds) {
        const cfg = linked.cfgs[statsCfgId];
        if (!cfg) continue;
        loadSnapshot(statsEntryHash);
        cfgEntryHashes.set(statsCfgId, statsEntryHash);
        const layout = cfgLayouts.get(statsCfgId);
        if (layout && layout.walkPlan.length > 0) {
          const statsStored = storedStates.get(statsEntryHash);
          walkCfgBlocks(layout, live, cfg.scene, blockIndex, statements, (blockId) => {
            blockToSegment.set(blockId, statsSyntheticSegId);
            const delta = computeBlockDelta(globals, temps, statsStored);
            if (delta) blockDeltas.set(blockId, delta);
          });
        }
        for (const exit of cfg.exits) {
          if (exit.target.type !== "cfg") continue;
          const targetCfgId = exit.target.cfgId;
          if (cfgEntryHashes.has(targetCfgId)) continue;
          const targetCfg = linked.cfgs[targetCfgId];
          if (!targetCfg || !linked.statsCfgIds.includes(targetCfgId)) continue;
          cfgEntryHashes.set(targetCfgId, snap());
        }
      }
      if (!segmentStates.has(statsSyntheticSegId)) {
        segmentStates.set(statsSyntheticSegId, {
          entry: getOrSerialize(statsEntryHash),
          exit: getOrSerialize(statsEntryHash)
        });
      }
    }
  }
  const walkedCfgs = new Set(cfgEntryHashes.keys());
  const cfgQueue = [];
  for (const cfgId of walkedCfgs) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg" || cfgEntryHashes.has(exit.target.cfgId)) continue;
      if (!linked.cfgs[exit.target.cfgId]) continue;
      cfgQueue.push(cfgId);
      break;
    }
  }
  let cqi = 0;
  while (cqi < cfgQueue.length) {
    const cfgId = cfgQueue[cqi++];
    const cfg = linked.cfgs[cfgId];
    const entryHash = cfgEntryHashes.get(cfgId);
    loadSnapshot(entryHash);
    const eStored = storedStates.get(entryHash);
    const synSegId = `__xcfg_${cfgId}`;
    const layout = cfgLayouts.get(cfgId);
    if (layout && layout.walkPlan.length > 0) {
      walkCfgBlocks(layout, live, cfg.scene, blockIndex, statements, (blockId) => {
        blockToSegment.set(blockId, synSegId);
        const delta = computeBlockDelta(globals, temps, eStored);
        if (delta) blockDeltas.set(blockId, delta);
      });
      segmentStates.set(synSegId, {
        entry: getOrSerialize(entryHash),
        exit: getOrSerialize(entryHash)
      });
    }
    for (const exit of cfg.exits) {
      if (exit.target.type !== "cfg") continue;
      const targetCfgId = exit.target.cfgId;
      if (cfgEntryHashes.has(targetCfgId)) continue;
      if (!linked.cfgs[targetCfgId]) continue;
      const h = snap();
      cfgEntryHashes.set(targetCfgId, h);
      cfgQueue.push(targetCfgId);
    }
  }
  const tReplay = performance.now();
  const cfgEntryStates = /* @__PURE__ */ new Map();
  for (const [cfgId, h] of cfgEntryHashes) {
    cfgEntryStates.set(cfgId, getOrSerialize(h));
  }
  const tSerialize = performance.now();
  const collector = new AnalysisCollector();
  const cfgIdsWithState = new Set(cfgEntryHashes.keys());
  for (const [cfgId, entryHash] of cfgEntryHashes) {
    const cfg = linked.cfgs[cfgId];
    if (!cfg) continue;
    const layout = cfgLayouts.get(cfgId);
    if (!layout || layout.walkPlan.length === 0) continue;
    loadSnapshot(entryHash);
    walkCfgBlocksWithAnalysis(layout, live, {
      cfgId,
      scene: cfg.scene,
      collector,
      statements,
      blockIndex
    });
  }
  const deadBlockSet = new Set(collector.deadBranches.map((d) => d.blockId));
  const controlFlowViolations = checkControlFlowViolations(linked, blockIndex, collector.icfStates, deadBlockSet);
  const undeclaredSets = collector.filterUndeclaredSets();
  const tAnalysis = performance.now();
  const timing = {
    seed: tSeed - t0,
    layout: tLayout - tSeed,
    solve: tSolve - tLayout,
    serialize: tSegSerialize - tSolve,
    statsXcfg: tReplay - tSegSerialize,
    cfgEntrySerialize: tSerialize - tReplay,
    analysis: tAnalysis - tSerialize,
    total: tAnalysis - t0
  };
  return {
    segmentStates,
    cfgEntryStates,
    blockDeltas,
    blockToSegment,
    segmentLoops,
    deadBranches: collector.deadBranches,
    undeclaredSets,
    multiReplaceViolations: collector.multiReplaceViolations,
    controlFlowViolations,
    cfgIdsWithState,
    totalIterations,
    widenedSccs,
    timing
  };
};

// ../analysis/refactor/rename.ts
function computeVariableRename(locationIndex, oldName, newName, scene) {
  let occurrences = locationIndex.queryIdentifier(oldName);
  if (scene && isTempOnly(locationIndex, oldName, scene)) {
    occurrences = occurrences.filter((o) => o.scene === scene);
  }
  const edits = deduplicateEdits(occurrences, newName);
  return { kind: "variable", oldName, newName, edits };
}
function isTempOnly(locationIndex, name, scene) {
  const ss = locationIndex.getSceneSymbols(scene);
  if (!ss || !ss.tempVariables.has(name.toLowerCase())) return false;
  return !locationIndex.getGlobalDeclaration(name);
}
function computeLabelRename(locationIndex, oldName, newName, scene) {
  const edits = [];
  const seen = /* @__PURE__ */ new Set();
  const lowerOld = oldName.toLowerCase();
  for (const sceneName of locationIndex.allSceneNames) {
    const ss = locationIndex.getSceneSymbols(sceneName);
    if (!ss) continue;
    for (const [name, label] of ss.labels) {
      if (name.toLowerCase() !== lowerOld || sceneName !== scene) continue;
      pushEdit(edits, seen, sceneName, label.label.lineNumber, label.label.position, label.label.value.length, newName);
    }
    for (const stmt of ss.gotos) {
      const ref = extractLabelRef(stmt, lowerOld, scene);
      if (ref) pushEdit(edits, seen, sceneName, ref.line, ref.position, ref.length, newName);
    }
    for (const stmt of ss.gosubs) {
      const ref = extractLabelRef(stmt, lowerOld, scene);
      if (ref) pushEdit(edits, seen, sceneName, ref.line, ref.position, ref.length, newName);
    }
  }
  return { kind: "label", oldName, newName, edits };
}
function computeAchievementRename(locationIndex, oldName, newName) {
  const edits = [];
  const seen = /* @__PURE__ */ new Set();
  const def = locationIndex.findAchievementDefinition(oldName);
  if (def) {
    const tok = def.achievement.codename;
    pushEdit(edits, seen, def.scene, tok.lineNumber, tok.position, tok.value.length, newName);
  }
  for (const ref of locationIndex.findAchievementReferences(oldName)) {
    pushEdit(edits, seen, ref.scene, ref.line, ref.position, ref.length, newName);
  }
  return { kind: "achievement", oldName, newName, edits };
}
function deduplicateEdits(occurrences, newText) {
  const edits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const occ of occurrences) {
    pushEdit(edits, seen, occ.scene, occ.line, occ.position, occ.length, newText);
  }
  return edits;
}
function pushEdit(edits, seen, scene, line, position, length, newText) {
  const key = `${scene}:${line}:${position}`;
  if (seen.has(key)) return;
  seen.add(key);
  edits.push({ scene, line, position, length, newText });
}
function extractLabelRef(stmt, lowerLabel, targetScene) {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    const label = stmt.label;
    if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
      return { line: label.lineNumber, position: label.position, length: label.value.length };
    }
  }
  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    const scene = stmt.scene;
    const label = stmt.label;
    if (scene && "value" in scene && scene.value.toLowerCase() === targetScene.toLowerCase()) {
      if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
        return { line: label.lineNumber, position: label.position, length: label.value.length };
      }
    }
  }
  return null;
}

// ../diff/diff-lines.ts
var diffLines = (oldLines, newLines) => {
  const n = oldLines.length;
  const m = newLines.length;
  let prefixLen = 0;
  const minLen = Math.min(n, m);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }
  let suffixLen = 0;
  while (suffixLen < minLen - prefixLen && oldLines[n - 1 - suffixLen] === newLines[m - 1 - suffixLen]) {
    suffixLen++;
  }
  const oldMid = oldLines.slice(prefixLen, n - suffixLen);
  const newMid = newLines.slice(prefixLen, m - suffixLen);
  if (oldMid.length === 0 && newMid.length === 0) return [];
  if (oldMid.length === 0 || newMid.length === 0) {
    return [{
      oldStart: prefixLen,
      oldCount: oldMid.length,
      newStart: prefixLen,
      newCount: newMid.length
    }];
  }
  const rawEdits = myersDiff(oldMid, newMid);
  const shifted = [];
  for (const e of rawEdits) {
    shifted.push({
      oldStart: e.oldStart + prefixLen,
      oldCount: e.oldCount,
      newStart: e.newStart + prefixLen,
      newCount: e.newCount
    });
  }
  return shifted;
};
var myersDiff = (a, b) => {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  v.fill(-1);
  const offset = max;
  v[offset + 1] = 0;
  const trace = [];
  outer:
    for (let d = 0; d <= max; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1]) {
          x = v[offset + k + 1];
        } else {
          x = v[offset + k - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) break outer;
      }
    }
  const ops = backtrack(trace, offset, n, m, a, b);
  return collapseOps(ops);
};
var backtrack = (trace, offset, n, m, _a, _b) => {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || k !== d && v[offset + k - 1] < v[offset + k + 1]) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: "equal", oldIdx: x, newIdx: y });
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: "insert", oldIdx: x, newIdx: y - 1 });
        y--;
      } else {
        ops.push({ type: "delete", oldIdx: x - 1, newIdx: y });
        x--;
      }
    }
  }
  ops.reverse();
  return ops;
};
var collapseOps = (ops) => {
  const edits = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      i++;
      continue;
    }
    let oldStart = ops[i].oldIdx;
    let newStart = ops[i].newIdx;
    let oldCount = 0;
    let newCount = 0;
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") {
        if (oldCount === 0) oldStart = ops[i].oldIdx;
        oldCount++;
      } else {
        if (newCount === 0) newStart = ops[i].newIdx;
        newCount++;
      }
      i++;
    }
    edits.push({ oldStart, oldCount, newStart, newCount });
  }
  return edits;
};

// ../diff/diff-scenes.ts
var diffScenes = (previous, current) => {
  const scenes = /* @__PURE__ */ new Map();
  for (const [name, prevContent] of previous) {
    const currContent = current.get(name);
    if (currContent === void 0) {
      scenes.set(name, { kind: "removed" });
      continue;
    }
    if (prevContent === currContent) {
      scenes.set(name, { kind: "unchanged" });
    } else {
      const oldLines = prevContent.split("\n");
      const newLines = currContent.split("\n");
      const edits = diffLines(oldLines, newLines);
      scenes.set(name, { kind: "modified", edits });
    }
  }
  for (const name of current.keys()) {
    if (!previous.has(name)) {
      scenes.set(name, { kind: "added" });
    }
  }
  return { scenes };
};

// ../pipeline/scan.ts
var scan = (scenes, incremental) => {
  const totalStart = performance.now();
  const cleanedScenes = scenes.filter((s) => s.error === void 0);
  const preScanStart = performance.now();
  const knownLabels = cleanedScenes.flatMap((s) => scanLabelNames(s));
  const sceneNames = scenes.map((s) => s.name);
  const labelTrie = new PrefixTrie(knownLabels);
  const sceneTrie = new PrefixTrie(sceneNames);
  const preScan = performance.now() - preScanStart;
  const scanStart = performance.now();
  let tokenId = 0;
  const allTokens = /* @__PURE__ */ new Map();
  const allCheckpoints = /* @__PURE__ */ new Map();
  const allSceneHashes = /* @__PURE__ */ new Map();
  const sceneTimes = [];
  let scenesReused = 0;
  for (const scene of cleanedScenes) {
    const change = incremental?.diff.scenes.get(scene.name);
    if (change?.kind === "unchanged" && incremental) {
      const prevTokens = incremental.previous.tokens.get(scene.name);
      const prevCheckpoints = incremental.previous.checkpoints.get(scene.name);
      const prevHashes = incremental.previous.sceneHashes.get(scene.name);
      if (prevTokens && prevCheckpoints && prevHashes) {
        for (const t of prevTokens) t.id = tokenId++;
        allTokens.set(scene.name, prevTokens);
        allCheckpoints.set(scene.name, prevCheckpoints);
        allSceneHashes.set(scene.name, prevHashes);
        scenesReused++;
        continue;
      }
    }
    const t0 = performance.now();
    const { tokens: raw, checkpoints: sceneCheckpoints } = scanScene(scene, labelTrie, sceneTrie);
    allCheckpoints.set(scene.name, sceneCheckpoints);
    const t1 = performance.now();
    const expanded = expandProse(raw, labelTrie, sceneTrie);
    const t2 = performance.now();
    allSceneHashes.set(scene.name, computeSceneHashes(expanded));
    for (const t of expanded) {
      t.id = tokenId++;
    }
    allTokens.set(scene.name, expanded);
    sceneTimes.push({
      name: scene.name,
      lines: scene.content.split("\n").length,
      scanMs: t1 - t0,
      expandMs: t2 - t1
    });
  }
  sceneTimes.sort((a, b) => b.scanMs + b.expandMs - (a.scanMs + a.expandMs));
  for (const s of sceneTimes.slice(0, 10)) {
    console.log(`  ${s.name.padEnd(30)} ${s.lines.toString().padStart(6)} lines  scan: ${s.scanMs.toFixed(0).padStart(6)}ms  expand: ${s.expandMs.toFixed(0).padStart(6)}ms`);
  }
  const scanTime = performance.now() - scanStart;
  return {
    tokens: allTokens,
    checkpoints: allCheckpoints,
    sceneHashes: allSceneHashes,
    knownLabels,
    sceneNames,
    timing: {
      preScan,
      scan: scanTime,
      total: performance.now() - totalStart,
      scenesScanned: cleanedScenes.length - scenesReused,
      scenesReused
    }
  };
};
var expandProse = (sceneTokens, knownLabels, sceneNames) => {
  const out = [];
  for (const token of sceneTokens) {
    if (token.type === "Prose") {
      const prose = token;
      const flat = flattenProse(prose.content, {
        sceneName: token.sceneName,
        lineNumber: token.lineNumber,
        position: token.position,
        indent: token.indent,
        knownLabels,
        sceneNames
      });
      if (flat.length > 0 && flat[0].type !== "Prose") {
        out.push({
          type: "Prose",
          sceneName: token.sceneName,
          lineNumber: token.lineNumber,
          position: token.position,
          indent: token.indent,
          content: ""
        });
      }
      out.push(...flat);
    } else if (token.type === "ChoiceOption") {
      const opt = token;
      out.push(opt);
      if (opt.rawText && opt.rawText.length > 0) {
        const flat = flattenProse(opt.rawText, {
          sceneName: token.sceneName,
          lineNumber: token.lineNumber,
          position: token.position + 1,
          indent: token.indent,
          knownLabels,
          sceneNames
        });
        out.push(...flat);
      }
    } else {
      out.push(token);
    }
  }
  return out;
};

// ../pipeline/parse.ts
var parse = (scanResult, incremental, parserOptions) => {
  const parseStart = performance.now();
  const asts = [];
  let scenesReused = 0;
  if (incremental) {
    const prevAstByName = /* @__PURE__ */ new Map();
    for (const ast of incremental.previousAsts) prevAstByName.set(ast.name, ast);
    for (const name of scanResult.sceneNames) {
      const change = incremental.diff.scenes.get(name);
      if (change?.kind === "unchanged") {
        const prevAst = prevAstByName.get(name);
        if (prevAst) {
          asts.push(prevAst);
          scenesReused++;
          continue;
        }
      }
      const sceneTokens = scanResult.tokens.get(name);
      if (!sceneTokens || sceneTokens.length === 0) continue;
      const parser = new Parser(sceneTokens, parserOptions);
      const ast = parser.parseScene();
      if (ast) asts.push(ast);
    }
  } else {
    for (const sceneTokens of scanResult.tokens.values()) {
      if (sceneTokens.length === 0) continue;
      const parser = new Parser(sceneTokens, parserOptions);
      const ast = parser.parseScene();
      if (ast) asts.push(ast);
    }
  }
  return {
    asts,
    timing: {
      parse: performance.now() - parseStart,
      scenesParsed: asts.length - scenesReused,
      scenesReused
    }
  };
};

// ../pipeline/pipeline.ts
var time = (fn) => {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
};
var yield_ = () => new Promise((r) => setTimeout(r, 0));
var findUnreachableCodeFromSegment = (result, segDataflow) => {
  findUnreachableCodeFromCfgIds(result, segDataflow.cfgIdsWithState);
};
async function runPipelineAsync(rawScenes, opts, onStage) {
  const totalStart = performance.now();
  onStage("diff");
  const [diff, diffT] = time(() => {
    if (!opts.previousScenes) return null;
    const current = /* @__PURE__ */ new Map();
    for (const s of rawScenes) current.set(s.name, s.content);
    return diffScenes(opts.previousScenes, current);
  });
  const incrementalScan = diff && opts.previousResult ? { diff, previous: opts.previousResult.scanResult } : void 0;
  onStage("scan");
  await yield_();
  const [scanResult, scanT] = time(() => scan(rawScenes, incrementalScan));
  const incrementalParse = diff && opts.previousResult ? { diff, previousAsts: opts.previousResult.parseResult.asts } : void 0;
  const parserOptions = opts.computeConditionHints ? { computeConditionHints: true } : void 0;
  onStage("parse");
  await yield_();
  const [parseResult, parseT] = time(() => parse(scanResult, incrementalParse, parserOptions));
  const { asts } = parseResult;
  onStage("reconcile");
  await yield_();
  const [plan, reconcile] = time(() => opts.reconciler.reconcile(asts));
  onStage("cfg");
  await yield_();
  const [extracted, linkCfgs2] = time(() => linkInterSceneControlFlow(asts, plan));
  const [navigationErrors, navigationT] = time(() => verifyNavigation(extracted));
  onStage("loops");
  await yield_();
  const [loopAnalysis, loopAnalysisT] = time(() => analyseLoops(extracted));
  onStage("graph");
  await yield_();
  const [cfgGraph, cfgGraphT] = time(() => buildGraph(extracted));
  onStage("segments");
  await yield_();
  const [segmentGraph, segmentsT] = time(() => buildSegments(extracted.linked, extracted.blockIndex, extracted.statements));
  onStage("segment-dataflow");
  await yield_();
  const [segmentDataflow, segmentDataflowT] = time(() => solveSegmentDataflow(segmentGraph, extracted.linked, extracted.blockIndex, extracted.statements));
  onStage("symbols");
  await yield_();
  const [symbolTable, symbolTableT] = time(() => buildGlobalSymbolTable(extracted, cfgGraph.order));
  onStage("index");
  await yield_();
  const [, segDeltaAttachT] = time(() => {
    extracted.locationIndex.attachSegmentDeltas(
      segmentDataflow.segmentStates,
      segmentDataflow.blockDeltas,
      segmentDataflow.blockToSegment
    );
  });
  const [, attachDfT] = time(() => {
    extracted.locationIndex.attachCfgEntryStates(segmentDataflow.cfgEntryStates);
  });
  const [, reachT] = time(() => attachReachability(extracted, cfgGraph));
  const [, branchesT] = time(() => {
    extracted.locationIndex.attachDeadBranches(segmentDataflow.deadBranches);
    extracted.locationIndex.attachTransfers(extracted.transfers);
    extracted.locationIndex.attachControlFlowViolations(segmentDataflow.controlFlowViolations);
    extracted.locationIndex.attachUndeclaredSets(segmentDataflow.undeclaredSets);
    extracted.locationIndex.attachMultiReplaceViolations(segmentDataflow.multiReplaceViolations);
  });
  const cfViolT = 0;
  const setDeclT = 0;
  const [, unreachT] = time(() => findUnreachableCodeFromSegment(extracted, segmentDataflow));
  const locationIndexT = segDeltaAttachT + attachDfT + reachT + branchesT + cfViolT + setDeclT + unreachT;
  const timing = {
    diff: diffT,
    scan: scanT,
    scanDetail: scanResult.timing,
    parse: parseT,
    parseDetail: parseResult.timing,
    reconcile,
    linkCfgs: linkCfgs2,
    navigation: navigationT,
    loopAnalysis: loopAnalysisT,
    cfgGraph: cfgGraphT,
    segments: segmentsT,
    segmentDataflow: segmentDataflowT,
    symbolTable: symbolTableT,
    locationIndex: locationIndexT,
    segDeltaAttach: segDeltaAttachT,
    attachDataflow: attachDfT,
    reachability: reachT,
    branches: branchesT,
    controlFlowVerify: cfViolT,
    setDeclVerify: setDeclT,
    unreachable: unreachT,
    total: performance.now() - totalStart
  };
  return {
    scenes: asts,
    plan,
    extracted,
    navigationErrors,
    loopAnalysis,
    cfgGraph,
    segmentGraph,
    segmentDataflow,
    symbolTable,
    locationIndex: extracted.locationIndex,
    diff,
    scanResult,
    parseResult,
    timing
  };
}
function runPipelineSync(rawScenes, opts) {
  const totalStart = performance.now();
  const [diff, diffT] = time(() => {
    if (!opts.previousScenes) return null;
    const current = /* @__PURE__ */ new Map();
    for (const s of rawScenes) current.set(s.name, s.content);
    return diffScenes(opts.previousScenes, current);
  });
  const incrementalScan = diff && opts.previousResult ? { diff, previous: opts.previousResult.scanResult } : void 0;
  const [scanResult, scanT] = time(() => scan(rawScenes, incrementalScan));
  const incrementalParse = diff && opts.previousResult ? { diff, previousAsts: opts.previousResult.parseResult.asts } : void 0;
  const parserOptions = opts.computeConditionHints ? { computeConditionHints: true } : void 0;
  const [parseResult, parseT] = time(() => parse(scanResult, incrementalParse, parserOptions));
  const { asts } = parseResult;
  const [plan, reconcile] = time(() => opts.reconciler.reconcile(asts));
  const [extracted, linkCfgs2] = time(() => linkInterSceneControlFlow(asts, plan));
  const [navigationErrors, navigationT] = time(() => verifyNavigation(extracted));
  const [loopAnalysis, loopAnalysisT] = time(() => analyseLoops(extracted));
  const [cfgGraph, cfgGraphT] = time(() => buildGraph(extracted));
  const [segmentGraph, segmentsT] = time(() => buildSegments(extracted.linked, extracted.blockIndex, extracted.statements));
  const [segmentDataflow, segmentDataflowT] = time(() => solveSegmentDataflow(segmentGraph, extracted.linked, extracted.blockIndex, extracted.statements));
  const [symbolTable, symbolTableT] = time(() => buildGlobalSymbolTable(extracted, cfgGraph.order));
  const [, segDeltaAttachT] = time(() => {
    extracted.locationIndex.attachSegmentDeltas(
      segmentDataflow.segmentStates,
      segmentDataflow.blockDeltas,
      segmentDataflow.blockToSegment
    );
  });
  const [, attachDfT] = time(() => {
    extracted.locationIndex.attachCfgEntryStates(segmentDataflow.cfgEntryStates);
  });
  const [, reachT] = time(() => attachReachability(extracted, cfgGraph));
  const [, branchesT] = time(() => {
    extracted.locationIndex.attachDeadBranches(segmentDataflow.deadBranches);
    extracted.locationIndex.attachTransfers(extracted.transfers);
    extracted.locationIndex.attachControlFlowViolations(segmentDataflow.controlFlowViolations);
    extracted.locationIndex.attachUndeclaredSets(segmentDataflow.undeclaredSets);
    extracted.locationIndex.attachMultiReplaceViolations(segmentDataflow.multiReplaceViolations);
  });
  const cfViolT = 0;
  const setDeclT = 0;
  const [, unreachT] = time(() => findUnreachableCodeFromSegment(extracted, segmentDataflow));
  const locationIndexT = segDeltaAttachT + attachDfT + reachT + branchesT + cfViolT + setDeclT + unreachT;
  const timing = {
    diff: diffT,
    scan: scanT,
    scanDetail: scanResult.timing,
    parse: parseT,
    parseDetail: parseResult.timing,
    reconcile,
    linkCfgs: linkCfgs2,
    navigation: navigationT,
    loopAnalysis: loopAnalysisT,
    cfgGraph: cfgGraphT,
    segments: segmentsT,
    segmentDataflow: segmentDataflowT,
    symbolTable: symbolTableT,
    locationIndex: locationIndexT,
    segDeltaAttach: segDeltaAttachT,
    attachDataflow: attachDfT,
    reachability: reachT,
    branches: branchesT,
    controlFlowVerify: cfViolT,
    setDeclVerify: setDeclT,
    unreachable: unreachT,
    total: performance.now() - totalStart
  };
  return {
    scenes: asts,
    plan,
    extracted,
    navigationErrors,
    loopAnalysis,
    cfgGraph,
    segmentGraph,
    segmentDataflow,
    symbolTable,
    locationIndex: extracted.locationIndex,
    diff,
    scanResult,
    parseResult,
    timing
  };
}
function runPipeline(rawScenes, opts) {
  if (opts.onStage) {
    return runPipelineAsync(rawScenes, opts, opts.onStage);
  }
  return runPipelineSync(rawScenes, opts);
}

// src/pipeline.ts
var decoder = new TextDecoder();
async function readWorkspaceScenes(folder) {
  const scenes = [];
  const pattern = new vscode.RelativePattern(folder, "*.txt");
  const files = await vscode.workspace.findFiles(pattern);
  for (const file of files) {
    const bytes = await vscode.workspace.fs.readFile(file);
    const content = decoder.decode(bytes);
    const name = file.path.split("/").pop().replace(/\.txt$/, "");
    scenes.push({
      sourceUrl: file.toString(),
      name,
      content,
      error: void 0,
      flow: []
    });
  }
  return scenes;
}
var WorkspaceAnalyser = class {
  reconciler = new CfgReconciler({});
  previousScenes;
  previousResult;
  async analyse(folder, options) {
    const rawScenes = await readWorkspaceScenes(folder);
    const sceneNames = rawScenes.map((s) => s.name);
    const pipelineOpts = {
      reconciler: this.reconciler,
      previousScenes: this.previousScenes,
      previousResult: this.previousResult,
      computeConditionHints: options?.computeConditionHints
    };
    const result = options?.onStage ? await runPipeline(rawScenes, { ...pipelineOpts, onStage: options.onStage }) : runPipeline(rawScenes, pipelineOpts);
    this.previousScenes = new Map(rawScenes.map((s) => [s.name, s.content]));
    this.previousResult = result;
    const parseErrors = /* @__PURE__ */ new Map();
    for (const ast of result.scenes) {
      if (ast.parseErrors && ast.parseErrors.length > 0) {
        parseErrors.set(ast.name, ast.parseErrors);
      }
    }
    return {
      scenes: result.scenes,
      parseErrors,
      navigationErrors: result.navigationErrors,
      knownLabels: rawScenes.flatMap((s) => scanLabelNames(s)),
      sceneNames,
      symbolTable: result.symbolTable,
      locationIndex: result.locationIndex,
      timing: result.timing
    };
  }
  reset() {
    this.reconciler = new CfgReconciler({});
    this.previousScenes = void 0;
    this.previousResult = void 0;
  }
};

// src/diagnostics.ts
var vscode2 = __toESM(require("vscode"));
var stripTokenLocation = (msg) => msg.replace(/ at '.*$/, "").replace(/ at end of scene .*$/, "");
function parseErrorToDiagnostic(error) {
  const line = error.token.lineNumber;
  const col = error.token.position;
  const endLine = error.endToken?.lineNumber ?? line;
  const endCol = error.endToken ? error.endToken.position + 1 : col + 1;
  const range2 = new vscode2.Range(line, col, endLine, endCol);
  const message = friendlyParseError(error);
  const diag = new vscode2.Diagnostic(
    range2,
    message,
    vscode2.DiagnosticSeverity.Error
  );
  diag.source = "choicescript";
  if (error.solutionCode !== void 0) {
    diag.code = error.solutionCode;
  }
  return diag;
}
function friendlyParseError(error) {
  const raw = error.message;
  const clean = stripTokenLocation(raw);
  if (clean.startsWith("Expect expression")) {
    return "Expected a value or expression here.";
  }
  if (clean.startsWith("Expect ')' after expression")) {
    return "Missing closing parenthesis \u2014 every ( needs a matching ).";
  }
  if (clean.startsWith("Expect ']' after accessor")) {
    return "Missing closing bracket \u2014 every [ needs a matching ].";
  }
  if (clean.startsWith("Expect '}' after")) {
    return "Missing closing brace \u2014 every { needs a matching }.";
  }
  if (clean.startsWith("Expect variable name")) {
    return "Expected a variable name here.";
  }
  if (clean.startsWith("Expect array name")) {
    return "Expected an array name here.";
  }
  if (clean.startsWith("Expect identifier")) {
    return "Expected a name here.";
  }
  if (clean.startsWith("Expect scene name")) {
    return "Expected a scene name here.";
  }
  if (clean.startsWith("Expect label name") || clean.startsWith("Expect valid label name")) {
    return "Expected a label name here.";
  }
  if (clean.startsWith("Expect ChoiceOption after modifiers")) {
    return "Expected a choice option (#) here \u2014 modifiers like *hide_reuse must appear on a choice option line.";
  }
  if (clean.includes("Dangling *else")) {
    return "This *else doesn't have a matching *if \u2014 check indentation.";
  }
  if (clean.includes("Concatenation (&) is strictly binary")) {
    return "The & operator joins exactly two values \u2014 use parentheses to chain more: (a & b) & c.";
  }
  if (clean.includes("*create is only allowed")) {
    return "*create must appear at the top of the startup scene, before any story text or commands.";
  }
  if (clean.includes("*create_array is only allowed")) {
    return "*create_array must appear at the top of the startup scene, before any story text or commands.";
  }
  if (clean.includes("Array count must be")) {
    return "Array size must be a plain number like 5 \u2014 variables and expressions are not allowed here.";
  }
  if (clean.startsWith("Expect URL")) {
    return "Expected a URL after *link.";
  }
  if (clean.startsWith("Expect path after *image")) {
    return "Expected an image file path after *image.";
  }
  if (clean.startsWith("Expect path after *text_image")) {
    return "Expected an image file path after *text_image.";
  }
  if (clean.startsWith("Expect achievement")) {
    return clean.replace("Expect ", "Expected ") + ".";
  }
  if (clean.startsWith("Expect author name")) {
    return "Expected the author name after *author.";
  }
  if (clean.startsWith("Expect button text")) {
    return "Expected button text after *page_break.";
  }
  if (clean.startsWith("Expect scene identifier")) {
    return "Expected a scene name in the *scene_list.";
  }
  if (clean.startsWith("Expect ")) {
    return clean.replace("Expect ", "Expected ") + ".";
  }
  return clean || raw;
}
var NAVIGATION_MESSAGES = {
  0: (e) => {
    const label = e.targetLabel;
    const scene = e.targetScene;
    if (scene && label) {
      return `Can't find the label "${label}" in scene "${scene}" \u2014 check the spelling, or make sure the label exists.`;
    }
    if (label) {
      return `Can't find the label "${label}" \u2014 check the spelling, or make sure the label exists in this scene.`;
    }
    return stripTokenLocation(e.message);
  },
  1: (e) => {
    const scene = e.targetScene;
    if (scene) {
      return `Can't find the scene "${scene}" \u2014 make sure a file named "${scene}.txt" exists in your scenes folder.`;
    }
    return stripTokenLocation(e.message);
  }
};
function navigationErrorToDiagnostic(error, folder) {
  const stmt = error.statement;
  const targetToken = error.targetLabel ? stmt.label ?? stmt.token : stmt.scene ?? stmt.token;
  const token = targetToken?.type ? targetToken : stmt.token;
  const line = token?.lineNumber ?? 0;
  const col = token?.position ?? 0;
  const len = token?.value?.length ?? token?.rawValue?.length ?? 1;
  const range2 = new vscode2.Range(line, col, line, col + len);
  const severity = error.severity === "Error" ? vscode2.DiagnosticSeverity.Error : vscode2.DiagnosticSeverity.Warning;
  const formatter = NAVIGATION_MESSAGES[error.solutionCode];
  const message = formatter ? formatter(error) : stripTokenLocation(error.message);
  const diag = new vscode2.Diagnostic(range2, message, severity);
  diag.source = "choicescript";
  const foundIn = error.context?.foundInScenes;
  if (foundIn?.length) {
    diag.relatedInformation = foundIn.map((f) => {
      const uri = vscode2.Uri.joinPath(folder, `${f.scene}.txt`);
      const loc = new vscode2.Location(uri, new vscode2.Position(f.line, 0));
      return new vscode2.DiagnosticRelatedInformation(loc, `Label "${error.targetLabel}" exists here`);
    });
    const sceneToken = stmt.scene;
    if (sceneToken) {
      const sceneLine = sceneToken.lineNumber ?? 0;
      const sceneCol = sceneToken.position ?? 0;
      const sceneLen = sceneToken.value?.length ?? sceneToken.rawValue?.length ?? 1;
      diag.code = "label-wrong-scene";
      diag._fixData = {
        sceneRange: new vscode2.Range(sceneLine, sceneCol, sceneLine, sceneCol + sceneLen),
        suggestions: foundIn.map((f) => f.scene)
      };
    }
  }
  return diag;
}
var DEAD_BRANCH_MESSAGES = {
  "condition-false": "This branch can never be reached \u2014 its condition is always false.",
  "condition-true-elsewhere": "This branch can never be reached \u2014 a previous branch's condition is always true, so this one is skipped.",
  "selectable-if-false": "This option can never be selected \u2014 its *selectable_if condition is always false."
};
var CONTROL_FLOW_MESSAGES = {
  "branch-fallthrough": "This branch needs a *goto, *finish, or *ending at the end \u2014 without one, the story has no way to continue after this point.",
  "choice-fallthrough": "This choice option needs a *goto, *finish, or *ending at the end \u2014 without one, the reader will skip past the remaining options.",
  "implicit-end": "This scene ends without a *goto, *finish, or *ending \u2014 the reader will have nowhere to go when they reach this point."
};
function deadBranchDiagnostic(branch) {
  const range2 = new vscode2.Range(branch.line, 0, branch.line, 1e3);
  const message = DEAD_BRANCH_MESSAGES[branch.reason] ?? "This branch can never be reached.";
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode2.DiagnosticTag.Unnecessary];
  return diag;
}
function controlFlowDiagnostic(violation) {
  const range2 = new vscode2.Range(violation.line, 0, violation.line, 1e3);
  const message = CONTROL_FLOW_MESSAGES[violation.kind] ?? "Missing explicit navigation";
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}
function undeclaredSetDiagnostic(v) {
  const range2 = new vscode2.Range(v.line, v.position, v.line, v.position + v.length);
  const message = v.kind === "set" ? `Variable "${v.variable}" is used in *set but was never declared with *create or *temp.` : `Variable "${v.variable}" has not been declared with *create or *temp.`;
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}
function multiReplaceDiagnostic(v) {
  const range2 = new vscode2.Range(v.line, v.position, v.line, v.position + 2);
  let message;
  if (v.kind === "zero-index") {
    message = `Multireplace selector is 0 (uninitialized). Multireplace is 1-indexed \u2014 valid range is 1 to ${v.alternativeCount}.`;
  } else if (v.kind === "string-selector") {
    message = `Multireplace selector is "${v.selectorValue}" (a string) which cannot be used as a numeric index. Multireplace expects a number (1 to ${v.alternativeCount}) or a boolean.`;
  } else {
    message = `Multireplace selector value ${v.selectorValue} is out of range. Valid range is 1 to ${v.alternativeCount}.`;
  }
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Error);
  diag.source = "choicescript";
  return diag;
}
function unusedVariableDiagnostic(v) {
  const range2 = new vscode2.Range(v.line, v.position, v.line, v.position + v.length);
  const scope = v.scope === "Global" ? "*create" : "*temp";
  const message = `Variable "${v.name}" is declared with ${scope} but never read.`;
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode2.DiagnosticTag.Unnecessary];
  return diag;
}
function unusedLabelDiagnostic(l) {
  const range2 = new vscode2.Range(l.line, l.position, l.line, l.position + l.length);
  const message = `Label "${l.name}" is never referenced by *goto or *gosub.`;
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode2.DiagnosticTag.Unnecessary];
  return diag;
}
var UNREACHABLE_MESSAGES = {
  "dead-scene": (item) => `This scene is never reached \u2014 no *goto_scene or *scene_list progression leads here.`,
  "dead-label": (item) => `The code starting at label "${item.label}" is never reached \u2014 no *goto or *gosub targets it.`,
  "dead-continuation": (item) => `This code is never reached \u2014 the *gosub that would return here is itself unreachable.`,
  "dead-code": (item) => `This code is never reached.`
};
function unreachableCodeDiagnostic(item) {
  const range2 = new vscode2.Range(item.line, 0, item.line, 1e3);
  const formatter = UNREACHABLE_MESSAGES[item.reason];
  const message = formatter ? formatter(item) : "This code is never reached.";
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Hint);
  diag.source = "choicescript";
  diag.tags = [vscode2.DiagnosticTag.Unnecessary];
  return diag;
}
function missingImageDiagnostic(img) {
  const range2 = new vscode2.Range(img.line, img.position, img.line, img.position + img.length);
  const message = `Image file "${img.path}" not found in the scenes folder.`;
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}
function achievementVariableConflictDiagnostic(c) {
  const range2 = new vscode2.Range(c.line, c.position, c.line, c.position + c.length);
  const message = `Achievement codename "${c.codename}" matches variable "${c.variable}" \u2014 this may cause confusion.`;
  const diag = new vscode2.Diagnostic(range2, message, vscode2.DiagnosticSeverity.Warning);
  diag.source = "choicescript";
  return diag;
}
function getSceneFromNavError(error) {
  const token = error.statement.token;
  return token?.sceneName ?? "unknown";
}
async function pushDiagnostics(collection, folder, result) {
  collection.clear();
  const allDiags = /* @__PURE__ */ new Map();
  for (const [sceneName, errors] of result.parseErrors) {
    const diags = allDiags.get(sceneName) ?? [];
    for (const err of errors) {
      diags.push(parseErrorToDiagnostic(err));
    }
    allDiags.set(sceneName, diags);
  }
  for (const err of result.navigationErrors) {
    const sceneName = getSceneFromNavError(err);
    const diags = allDiags.get(sceneName) ?? [];
    diags.push(navigationErrorToDiagnostic(err, folder));
    allDiags.set(sceneName, diags);
  }
  for (const branch of result.locationIndex.getDeadBranches()) {
    const diags = allDiags.get(branch.scene) ?? [];
    diags.push(deadBranchDiagnostic(branch));
    allDiags.set(branch.scene, diags);
  }
  for (const violation of result.locationIndex.getControlFlowViolations()) {
    const diags = allDiags.get(violation.scene) ?? [];
    diags.push(controlFlowDiagnostic(violation));
    allDiags.set(violation.scene, diags);
  }
  for (const v of result.locationIndex.getUndeclaredSets()) {
    const diags = allDiags.get(v.scene) ?? [];
    diags.push(undeclaredSetDiagnostic(v));
    allDiags.set(v.scene, diags);
  }
  for (const v of result.locationIndex.getMultiReplaceViolations()) {
    const diags = allDiags.get(v.scene) ?? [];
    diags.push(multiReplaceDiagnostic(v));
    allDiags.set(v.scene, diags);
  }
  for (const v of result.locationIndex.getUnusedVariables()) {
    const diags = allDiags.get(v.scene) ?? [];
    diags.push(unusedVariableDiagnostic(v));
    allDiags.set(v.scene, diags);
  }
  for (const l of result.locationIndex.getUnusedLabels()) {
    const diags = allDiags.get(l.scene) ?? [];
    diags.push(unusedLabelDiagnostic(l));
    allDiags.set(l.scene, diags);
  }
  for (const item of result.locationIndex.getUnreachableCode()) {
    const diags = allDiags.get(item.scene) ?? [];
    diags.push(unreachableCodeDiagnostic(item));
    allDiags.set(item.scene, diags);
  }
  for (const c of result.locationIndex.getAchievementVariableConflicts()) {
    const diags = allDiags.get(c.scene) ?? [];
    diags.push(achievementVariableConflictDiagnostic(c));
    allDiags.set(c.scene, diags);
  }
  const imageRefs = result.locationIndex.getImageReferences();
  const imageChecks = await Promise.all(imageRefs.map(async (img) => {
    const uri = vscode2.Uri.joinPath(folder, img.path);
    try {
      await vscode2.workspace.fs.stat(uri);
      return null;
    } catch {
      return img;
    }
  }));
  for (const img of imageChecks) {
    if (!img) continue;
    const diags = allDiags.get(img.scene) ?? [];
    diags.push(missingImageDiagnostic(img));
    allDiags.set(img.scene, diags);
  }
  for (const [sceneName, diags] of allDiags) {
    const uri = vscode2.Uri.joinPath(folder, `${sceneName}.txt`);
    collection.set(uri, diags);
  }
}

// src/semantic-tokens.ts
var vscode3 = __toESM(require("vscode"));
var TOKEN_TYPES = [
  "keyword",
  "variable",
  "number",
  "string",
  "comment",
  "operator",
  "macro",
  "function",
  "type",
  "parameter"
];
var TOKEN_MODIFIERS = ["declaration", "readonly", "defaultLibrary"];
var legend = new vscode3.SemanticTokensLegend(
  [...TOKEN_TYPES],
  [...TOKEN_MODIFIERS]
);
var typeIndex = {};
TOKEN_TYPES.forEach((t, i) => typeIndex[t] = i);
var modIndex = {};
TOKEN_MODIFIERS.forEach((m, i) => modIndex[m] = i);
var COMMAND_LENGTHS = {
  If: 3,
  ElseIf: 8,
  Else: 5,
  Choice: 7,
  FakeChoice: 12,
  GotoLabel: 5,
  GotoScene: 11,
  GoSub: 6,
  GoSubScene: 12,
  Return: 7,
  Finish: 7,
  Ending: 7,
  Bug: 7,
  GotoRandomScene: 18,
  SelectableIf: 14,
  CreateVariable: 7,
  CreateTempVariable: 5,
  SetVariable: 4,
  DeleteVariable: 7,
  CreateArray: 13,
  CreateTempArray: 11,
  DeleteArray: 13,
  Label: 6,
  PageBreak: 11,
  LineBreak: 11,
  Image: 6,
  Link: 5,
  InputText: 11,
  InputNumber: 13,
  GenerateRandom: 5,
  Achievement: 12,
  Achieve: 8,
  CheckAchievements: 19,
  StatChart: 11,
  SceneList: 11,
  Author: 7,
  GameIdentifier: 5,
  Parameters: 7,
  SaveCheckpoint: 16,
  RestoreCheckpoint: 19,
  HideReuse: 11,
  DisableReuse: 14,
  AllowReuse: 12,
  Comment: 8
};
function getMapping(token) {
  const t = token.type;
  switch (t) {
    case "If":
    case "ElseIf":
    case "Else":
    case "Choice":
    case "FakeChoice":
    case "GotoLabel":
    case "GotoScene":
    case "GoSub":
    case "GoSubScene":
    case "Return":
    case "Finish":
    case "Ending":
    case "GotoRandomScene":
    case "SelectableIf":
    case "CreateVariable":
    case "CreateTempVariable":
    case "SetVariable":
    case "DeleteVariable":
    case "CreateArray":
    case "CreateTempArray":
    case "DeleteArray":
    case "PageBreak":
    case "LineBreak":
    case "Image":
    case "TextImage":
    case "Link":
    case "InputText":
    case "InputNumber":
    case "GenerateRandom":
    case "Achievement":
    case "Achieve":
    case "CheckAchievements":
    case "StatChart":
    case "SceneList":
    case "Author":
    case "GameIdentifier":
    case "Parameters":
    case "SaveCheckpoint":
    case "RestoreCheckpoint":
    case "HideReuse":
    case "DisableReuse":
    case "AllowReuse":
      return { type: typeIndex.keyword, modifiers: 0 };
    case "Label":
      return {
        type: typeIndex.keyword,
        modifiers: 1 << modIndex.declaration
      };
    case "Comment":
      return { type: typeIndex.comment, modifiers: 0 };
    case "Identifier":
      return { type: typeIndex.variable, modifiers: 0 };
    case "NumberLiteral":
      return { type: typeIndex.number, modifiers: 0 };
    case "StringLiteral":
      return { type: typeIndex.string, modifiers: 0 };
    case "BooleanLiteral":
      return { type: typeIndex.keyword, modifiers: 0 };
    case "AssignmentOperator":
    case "EqualityOperator":
      return { type: typeIndex.operator, modifiers: 0 };
    case "FairmathAdditionOperator":
    case "FairmathSubtractionOperator":
      return { type: typeIndex.macro, modifiers: 0 };
    case "ChoiceOption":
      return { type: typeIndex.string, modifiers: 0 };
    case "OpenPrint":
    case "OpenPrintCapitaliseFirst":
    case "OpenPrintCapitaliseAll":
    case "Dollar":
      return { type: typeIndex.variable, modifiers: 0 };
    case "OpenMultiReplace":
    case "MultiReplaceElse":
      return { type: typeIndex.macro, modifiers: 0 };
    default:
      if (t === "LogicalAnd" || t === "LogicalOr" || t === "NotOperator")
        return { type: typeIndex.keyword, modifiers: 0 };
      const raw = token.rawValue;
      if (raw !== void 0)
        return { type: typeIndex.operator, modifiers: 0 };
      return null;
  }
}
function getTokenLength(token) {
  const t = token.type;
  const cmdLen = COMMAND_LENGTHS[t];
  if (cmdLen !== void 0) return cmdLen;
  if (t === "StringLiteral") {
    const str = token.value;
    return str.length + 2;
  }
  const val = token.value;
  if (typeof val === "boolean") return val ? 4 : 5;
  if (typeof val === "string") return val.length;
  if (typeof val === "number") return String(val).length;
  const raw = token.rawValue;
  if (typeof raw === "string") return raw.length;
  const content = token.content;
  if (typeof content === "string") return content.length;
  const rawText = token.rawText;
  if (typeof rawText === "string") return rawText.length + 1;
  return 1;
}
function resolveLabel(name, locationIndex, targetScene) {
  const ss = locationIndex?.getSceneSymbols(targetScene);
  if (!ss) return false;
  if (ss.labels.has(name)) return true;
  const lower = name.toLowerCase();
  for (const key of ss.labels.keys()) {
    if (key.toLowerCase() === lower) return true;
  }
  return false;
}
function resolveIdentifierMapping(token, locationIndex, sceneName, prevCommandToken, prevSceneArg) {
  const id = token;
  const name = id.value;
  if (!name) return null;
  const isSceneArg = prevCommandToken === "GotoScene" || prevCommandToken === "GoSubScene";
  const isLabelArg = prevCommandToken === "GotoLabel" || prevCommandToken === "GoSub" || isSceneArg && prevSceneArg !== null;
  if (id.isSceneName || isSceneArg && !prevSceneArg) {
    const resolved = locationIndex?.getSceneSymbols(name);
    return {
      type: resolved ? typeIndex.type : typeIndex.variable,
      modifiers: resolved ? 1 << modIndex.defaultLibrary : 0
    };
  }
  if (prevCommandToken === "Label") {
    const isSubroutine = locationIndex?.isGosubTarget(sceneName, name) ?? false;
    return {
      type: isSubroutine ? typeIndex.macro : typeIndex.function,
      modifiers: 1 << modIndex.declaration
    };
  }
  if (id.isLabelName || isLabelArg) {
    const isGosubRef = prevCommandToken === "GoSub" || prevCommandToken === "GoSubScene";
    const targetScene = prevSceneArg ?? sceneName;
    const resolved = resolveLabel(name, locationIndex, targetScene);
    return {
      type: resolved ? isGosubRef ? typeIndex.macro : typeIndex.function : typeIndex.variable,
      modifiers: resolved ? 1 << modIndex.defaultLibrary : 0
    };
  }
  if (prevCommandToken === "Achieve" || prevCommandToken === "Achievement") {
    const resolved = locationIndex?.findAchievementDefinition(name);
    return {
      type: resolved ? typeIndex.function : typeIndex.variable,
      modifiers: resolved ? 1 << modIndex.defaultLibrary : 0
    };
  }
  if (prevCommandToken === "Parameters") {
    return { type: typeIndex.parameter, modifiers: 1 << modIndex.declaration };
  }
  if (prevCommandToken === "Image" || prevCommandToken === "TextImage") {
    return { type: typeIndex.keyword, modifiers: 0 };
  }
  if (name && locationIndex?.isParamVariable(sceneName, name)) {
    return { type: typeIndex.parameter, modifiers: 0 };
  }
  return null;
}
function buildSemanticTokens(text, sceneName, knownLabels, sceneNames, locationIndex = null) {
  const builder = new vscode3.SemanticTokensBuilder(legend);
  const scene = {
    sourceUrl: `vscode://${sceneName}`,
    name: sceneName,
    content: text,
    error: void 0,
    flow: []
  };
  let tokens;
  try {
    ({ tokens } = scanScene(scene, knownLabels, sceneNames));
  } catch {
    return builder;
  }
  let prevCommandToken = null;
  let prevSceneArg = null;
  const mapped = tokens.map((token) => {
    const t = token.type;
    if (t === "GotoLabel" || t === "GotoScene" || t === "GoSub" || t === "GoSubScene" || t === "Achieve" || t === "Achievement" || t === "Image" || t === "TextImage" || t === "Label" || t === "Parameters") {
      prevCommandToken = t;
      prevSceneArg = null;
    }
    let mapping = null;
    if (t === "Identifier") {
      const id = token;
      if (id.isSceneName && (prevCommandToken === "GotoScene" || prevCommandToken === "GoSubScene")) {
        prevSceneArg = id.value;
      }
      mapping = resolveIdentifierMapping(token, locationIndex, sceneName, prevCommandToken, prevSceneArg);
    }
    if (!mapping) mapping = getMapping(token);
    if (!mapping) return null;
    const len = getTokenLength(token);
    if (len <= 0 || token.lineNumber < 0 || token.position < 0) return null;
    return { line: token.lineNumber, col: token.position, len, ...mapping };
  }).filter((t) => t !== null).sort((a, b) => a.line - b.line || a.col - b.col);
  let prevLine = -1, prevCol = -1;
  for (const t of mapped) {
    if (t.line === prevLine && t.col === prevCol) continue;
    try {
      builder.push(t.line, t.col, t.len, t.type, t.modifiers);
    } catch {
      continue;
    }
    prevLine = t.line;
    prevCol = t.col;
  }
  return builder;
}
var ChoiceScriptSemanticTokensProvider = class {
  knownLabels = [];
  sceneNames = [];
  locationIndex = null;
  cache = /* @__PURE__ */ new Map();
  _onDidChangeSemanticTokens = new vscode3.EventEmitter();
  onDidChangeSemanticTokens = this._onDidChangeSemanticTokens.event;
  updateContext(knownLabels, sceneNames, locationIndex = null) {
    this.knownLabels = knownLabels;
    this.sceneNames = sceneNames;
    this.locationIndex = locationIndex;
    this.cache.clear();
    this._onDidChangeSemanticTokens.fire();
  }
  provideDocumentSemanticTokens(document) {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached && cached.version === document.version) return cached.tokens;
    const name = document.fileName.replace(/\\/g, "/").split("/").pop().replace(/\.txt$/, "");
    const builder = buildSemanticTokens(
      document.getText(),
      name,
      this.knownLabels,
      this.sceneNames,
      this.locationIndex
    );
    const tokens = builder.build();
    this.cache.set(key, { version: document.version, tokens });
    return tokens;
  }
};

// src/hover.ts
var vscode4 = __toESM(require("vscode"));

// src/stringify-expression.ts
function stringifyExpression(expr) {
  switch (expr.kind) {
    case "Literal":
      return formatLiteral(expr.value.value);
    case "Identifier":
      return expr.token.value;
    case "Binary": {
      const b = expr;
      const op = b.operator.rawValue ?? "?";
      return `${stringifyExpression(b.left)} ${op} ${stringifyExpression(b.right)}`;
    }
    case "Unary": {
      const u = expr;
      return `${u.operator.rawValue} ${stringifyExpression(u.value)}`;
    }
    case "Grouping":
      return `(${stringifyExpression(expr.expression)})`;
    case "Dereference":
      return `{${stringifyExpression(expr.expression)}}`;
    default:
      return "(expr)";
  }
}
function formatLiteral(v) {
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

// src/hover.ts
var ChoiceScriptHoverProvider = class {
  symbolTable = { sites: [], variables: /* @__PURE__ */ new Map() };
  locationIndex = null;
  labelRefIndex = /* @__PURE__ */ new Map();
  folder = null;
  updateData(symbolTable, locationIndex, folder) {
    this.symbolTable = symbolTable;
    this.locationIndex = locationIndex;
    if (folder) this.folder = folder;
    this.labelRefIndex = this.buildLabelRefIndex();
  }
  buildLabelRefIndex() {
    const index = /* @__PURE__ */ new Map();
    if (!this.locationIndex) return index;
    for (const sceneName of this.locationIndex.allSceneNames) {
      const ss = this.locationIndex.getSceneSymbols(sceneName);
      if (!ss) continue;
      for (const goto of ss.gotos) {
        if (goto.kind === "GotoLabel") {
          const g = goto;
          if ("value" in g.label) {
            const labelName = g.label.value;
            const targetScene = sceneName;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gotoCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
        if (goto.kind === "GotoScene") {
          const g = goto;
          if (g.label && "value" in g.label && "value" in g.scene) {
            const labelName = g.label.value;
            const targetScene = g.scene.value;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gotoCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
      }
      for (const gosub of ss.gosubs) {
        if (gosub.kind === "GoSub") {
          const g = gosub;
          if ("value" in g.label) {
            const labelName = g.label.value;
            const targetScene = sceneName;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gosubCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
        if (gosub.kind === "GoSubScene") {
          const g = gosub;
          if (g.label && "value" in g.label && "value" in g.scene) {
            const labelName = g.label.value;
            const targetScene = g.scene.value;
            const key = `${targetScene}:${labelName}`;
            const entry = index.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
            entry.gosubCount++;
            if (!entry.scenes.includes(sceneName)) entry.scenes.push(sceneName);
            index.set(key, entry);
          }
        }
      }
    }
    return index;
  }
  provideHover(document, position) {
    const range2 = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range2) return null;
    const word = document.getText(range2);
    const line = document.lineAt(position.line).text;
    const sceneName = fileToScene(document.fileName);
    const linePrefix = line.substring(0, range2.start.character).trimStart();
    let hover = null;
    if (/\*label\s+$/i.test(linePrefix)) {
      hover = this.labelDefinitionHover(word, sceneName, range2);
    } else if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      hover = this.labelReferenceHover(word, sceneName, range2);
    } else if (/\*(goto_scene|gosub_scene)\s+$/i.test(linePrefix)) {
      hover = this.sceneHover(word, range2);
    } else if (/\*achieve\s+$/i.test(linePrefix)) {
      hover = this.achieveHover(word, range2);
    } else if (linePrefix === "*" || linePrefix === "") {
      const cmdMatch = line.trimStart().match(/^\*(\w+)/);
      if (cmdMatch && cmdMatch[1] === word) {
        hover = this.commandHover(word, range2);
      }
    }
    if (!hover) {
      hover = this.variableHover(word, sceneName, position.line, range2);
    }
    this.appendLocationInfo(hover, sceneName, position.line);
    return hover;
  }
  appendLocationInfo(hover, sceneName, line) {
    if (!hover || !this.locationIndex) return;
    const result = this.locationIndex.queryLocation({ scene: sceneName, line });
    if (result.entries.length === 0) return;
    const entry = result.entries[0];
    const md = hover.contents[hover.contents.length - 1];
    if (!md?.appendMarkdown) return;
    md.appendMarkdown(`

---

`);
    md.appendMarkdown(`\`cfg\` \`${entry.cfgId}\` \xB7 \`block\` \`${entry.scene}:${entry.line + 1}\` \xB7 \`stmt\` \`${entry.statementKind}\``);
  }
  appendDataflowInfo(md, variable, sceneName, line, isParam = false) {
    if (!this.locationIndex) return;
    const locResult = this.locationIndex.queryLocation({ scene: sceneName, line });
    const entry = locResult.entries.length > 0 ? locResult.entries[0] : null;
    const cfgId = entry?.cfgId;
    const isMutation = entry ? MUTATION_KINDS.has(entry.statementKind) : false;
    const isGosubCfg = cfgId ? cfgId.includes(":") && cfgId.split(":")[1] !== "" : false;
    if (isGosubCfg && cfgId && entry) {
      if (isMutation) {
        const callSites = this.locationIndex.getCallSiteBeforeAndAfter(cfgId, entry.statementId, sceneName);
        if (callSites.length > 0) {
          this.appendCallSiteTransitionTable(md, callSites, variable, sceneName);
          return;
        }
      } else {
        const callSites = this.locationIndex.getCallSiteStateAtStatement(cfgId, entry.statementId, sceneName);
        if (callSites.length > 0) {
          this.appendCallSiteValueTable(md, callSites, variable, sceneName);
          return;
        }
      }
    }
    if (entry && isMutation) {
      const attributed = this.locationIndex.getAttributedBeforeAndAfter(entry.statementId, sceneName);
      if (attributed.length > 0 && attributed.some((a) => a.provenance && a.provenance.length > 0)) {
        this.appendAttributedTransitionTable(md, attributed, variable, sceneName);
        return;
      }
      if (attributed.length > 0) {
        this.appendPlainTransitions(md, attributed, variable, sceneName);
        return;
      }
    }
    if (entry) {
      const attributed = this.locationIndex.getAttributedStatesAtStatement(entry.statementId, sceneName);
      if (attributed.length > 0 && attributed.some((a) => a.provenance && a.provenance.length > 0)) {
        this.appendAttributedValueTable(md, attributed, variable, sceneName);
        return;
      }
      if (attributed.length > 0) {
        this.appendPlainValues(md, attributed, variable, sceneName);
        return;
      }
    }
    const dfStates = locResult.dataflow ?? this.locationIndex.getDataflowForIdentifier(variable, sceneName, line);
    if (!dfStates || dfStates.length === 0) return;
    const values = dfStates.map((s) => lookupVariable(s, variable, sceneName)).filter((v) => v !== null && v.kind !== "bottom");
    if (values.length === 0) return;
    const formatted = [...new Set(values.map(formatAbstractValue))];
    md.appendMarkdown(`

---

`);
    if (formatted.length === 1) {
      md.appendMarkdown(`**Dataflow** \xB7 ${formatted[0]}`);
    } else {
      md.appendMarkdown(`**Dataflow** (${formatted.length} states)

`);
      for (const f of formatted) md.appendMarkdown(`- ${f}
`);
    }
  }
  appendCallSiteTransitionTable(md, callSites, variable, scene) {
    const rows = [];
    const seen = /* @__PURE__ */ new Map();
    for (const cs of callSites) {
      const bv = lookupVariable(cs.before, variable, scene);
      const av = lookupVariable(cs.after, variable, scene);
      if (!bv && !av) continue;
      const bf = bv && bv.kind !== "bottom" ? formatAbstractValue(bv) : "?";
      const af = av && av.kind !== "bottom" ? formatAbstractValue(av) : "?";
      const key = `${cs.callerScene}\0${cs.callerLine}\0${bf}\0${af}`;
      if (!seen.has(key)) {
        seen.set(key, rows.length);
        rows.push({ scene: cs.callerScene, line: cs.callerLine, before: bf, after: af });
      }
    }
    if (rows.length === 0) return;
    md.appendMarkdown(`

---

`);
    md.appendMarkdown(`**Dataflow** (${rows.length} call site${rows.length !== 1 ? "s" : ""})

`);
    md.appendMarkdown(`| Caller | Before | After |
`);
    md.appendMarkdown(`|:--|:--|:--|
`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      md.appendMarkdown(`| ${this.sceneLink(r.scene, r.line)} | ${r.before} | ${r.after} |
`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`
*...+${rows.length - MAX_ROWS} more*
`);
  }
  appendCallSiteValueTable(md, callSites, variable, scene) {
    const rows = [];
    const seen = /* @__PURE__ */ new Map();
    for (const cs of callSites) {
      const v = lookupVariable(cs.state, variable, scene);
      if (!v || v.kind === "bottom") continue;
      const formatted = formatAbstractValue(v);
      const key = `${cs.callerScene}\0${cs.callerLine}\0${formatted}`;
      if (!seen.has(key)) {
        seen.set(key, rows.length);
        rows.push({ scene: cs.callerScene, line: cs.callerLine, value: formatted });
      }
    }
    if (rows.length === 0) return;
    md.appendMarkdown(`

---

`);
    md.appendMarkdown(`**Dataflow** (${rows.length} call site${rows.length !== 1 ? "s" : ""})

`);
    md.appendMarkdown(`| Caller | Value |
`);
    md.appendMarkdown(`|:--|:--|
`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      md.appendMarkdown(`| ${this.sceneLink(r.scene, r.line)} | ${r.value} |
`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`
*...+${rows.length - MAX_ROWS} more*
`);
  }
  appendAttributedTransitionTable(md, attributed, variable, scene) {
    const rows = [];
    for (const a of attributed) {
      const bv = lookupVariable(a.before, variable, scene);
      const av = lookupVariable(a.after, variable, scene);
      if (!bv && !av) continue;
      const bf = bv && bv.kind !== "bottom" ? formatAbstractValue(bv) : "?";
      const af = av && av.kind !== "bottom" ? formatAbstractValue(av) : "?";
      const prov = a.provenance?.[0];
      const label = prov?.label ?? "Entry";
      rows.push({ label, before: bf, after: af, provenance: prov });
    }
    if (rows.length === 0) return;
    md.appendMarkdown(`

---

`);
    md.appendMarkdown(`**Dataflow** (${rows.length} state${rows.length !== 1 ? "s" : ""})

`);
    md.appendMarkdown(`| Context | Before | After |
`);
    md.appendMarkdown(`|:--|:--|:--|
`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      const link = r.provenance?.scene != null && r.provenance?.line != null ? this.sceneLink(r.provenance.scene, r.provenance.line) : `\`${r.label}\``;
      md.appendMarkdown(`| ${link} | ${r.before} | ${r.after} |
`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`
*...+${rows.length - MAX_ROWS} more*
`);
  }
  appendAttributedValueTable(md, attributed, variable, scene) {
    const rows = [];
    for (const a of attributed) {
      const v = lookupVariable(a.state, variable, scene);
      if (!v || v.kind === "bottom") continue;
      const formatted = formatAbstractValue(v);
      const prov = a.provenance?.[0];
      const label = prov?.label ?? "Entry";
      rows.push({ label, value: formatted, provenance: prov });
    }
    if (rows.length === 0) return;
    md.appendMarkdown(`

---

`);
    md.appendMarkdown(`**Dataflow** (${rows.length} state${rows.length !== 1 ? "s" : ""})

`);
    md.appendMarkdown(`| Context | Value |
`);
    md.appendMarkdown(`|:--|:--|
`);
    const MAX_ROWS = 8;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS); i++) {
      const r = rows[i];
      const link = r.provenance?.scene != null && r.provenance?.line != null ? this.sceneLink(r.provenance.scene, r.provenance.line) : `\`${r.label}\``;
      md.appendMarkdown(`| ${link} | ${r.value} |
`);
    }
    if (rows.length > MAX_ROWS) md.appendMarkdown(`
*...+${rows.length - MAX_ROWS} more*
`);
  }
  appendPlainTransitions(md, attributed, variable, scene) {
    const unique = /* @__PURE__ */ new Map();
    const deduped = [];
    for (const a of attributed) {
      const bv = lookupVariable(a.before, variable, scene);
      const av = lookupVariable(a.after, variable, scene);
      if (!bv && !av) continue;
      const bf = bv && bv.kind !== "bottom" ? formatAbstractValue(bv) : "?";
      const af = av && av.kind !== "bottom" ? formatAbstractValue(av) : "?";
      const key = `${bf}\0${af}`;
      if (!unique.has(key)) {
        unique.set(key, true);
        deduped.push({ before: bf, after: af });
      }
    }
    if (deduped.length === 0) return;
    md.appendMarkdown(`

---

`);
    if (deduped.length === 1) {
      md.appendMarkdown(`**Dataflow** \xB7 ${deduped[0].before} \u2192 ${deduped[0].after}`);
    } else {
      md.appendMarkdown(`**Dataflow** (${deduped.length} states)

`);
      for (const d of deduped) md.appendMarkdown(`- ${d.before} \u2192 ${d.after}
`);
    }
  }
  appendPlainValues(md, attributed, variable, scene) {
    const values = attributed.map((a) => lookupVariable(a.state, variable, scene)).filter((v) => v !== null && v.kind !== "bottom");
    if (values.length === 0) return;
    const formatted = [...new Set(values.map(formatAbstractValue))];
    md.appendMarkdown(`

---

`);
    if (formatted.length === 1) {
      md.appendMarkdown(`**Dataflow** \xB7 ${formatted[0]}`);
    } else {
      md.appendMarkdown(`**Dataflow** (${formatted.length} states)

`);
      for (const f of formatted) md.appendMarkdown(`- ${f}
`);
    }
  }
  sceneLink(scene, line) {
    if (!this.folder) return `\`${scene}:${line + 1}\``;
    const uri = vscode4.Uri.joinPath(this.folder, `${scene}.txt`).with({ fragment: `L${line + 1}` });
    return `[\`${scene}:${line + 1}\`](${uri.toString()})`;
  }
  variableHover(name, sceneName, line, range2) {
    const lowerName = name.toLowerCase();
    const summary = this.findVariableSummary(lowerName);
    const decl = this.findDeclaration(lowerName, sceneName);
    if (!summary && !decl) return null;
    const md = new vscode4.MarkdownString();
    md.isTrusted = true;
    const scope = summary?.scope ?? decl?.scope ?? "Global";
    const isParam = summary?.isParam ?? this.hasParam(sceneName, lowerName) ?? false;
    const keyword = isParam ? "params" : scope === "Temporary" ? "temp" : "create";
    md.appendMarkdown(`**${keyword} \`${name}\`**`);
    if (isParam) {
      md.appendMarkdown(`

*Subroutine parameter \u2014 value passed by caller via \\*gosub*`);
    }
    if (decl) {
      if (decl.expression) {
        md.appendMarkdown(` = \`${stringifyExpression(decl.expression)}\``);
      }
      md.appendMarkdown(`

`);
      md.appendMarkdown(`*Declared in* \`${decl.token.sceneName}\` line ${decl.token.lineNumber + 1}`);
    }
    if (this.locationIndex) {
      const varLoc = this.locationIndex.queryVariable({ variable: name });
      const sceneFilter = scope === "Temporary" ? (d) => d.scene === sceneName : () => true;
      const declarations = varLoc.definitions.filter((d) => sceneFilter(d) && DECLARATION_KINDS.has(d.statementKind));
      const modifications = varLoc.definitions.filter((d) => sceneFilter(d) && !DECLARATION_KINDS.has(d.statementKind));
      const refs = varLoc.references.filter(sceneFilter);
      const deletes = varLoc.deletes.filter(sceneFilter);
      md.appendMarkdown(`

---

`);
      const parts = [];
      if (declarations.length > 0) parts.push(`${declarations.length} declaration${declarations.length !== 1 ? "s" : ""}`);
      if (modifications.length > 0) parts.push(`${modifications.length} modification${modifications.length !== 1 ? "s" : ""}`);
      if (refs.length > 0) parts.push(`${refs.length} reference${refs.length !== 1 ? "s" : ""}`);
      if (deletes.length > 0) parts.push("deleted");
      md.appendMarkdown(parts.join(", "));
      const allScenes = /* @__PURE__ */ new Set([
        ...varLoc.definitions.map((d) => d.scene),
        ...refs.map((r) => r.scene)
      ]);
      if (allScenes.size > 1 && allScenes.size <= 8) {
        md.appendMarkdown(`

*Used in:* ${[...allScenes].map((s) => `\`${s}\``).join(", ")}`);
      } else if (allScenes.size > 8) {
        md.appendMarkdown(`

*Used in ${allScenes.size} scenes*`);
      }
    } else if (summary) {
      md.appendMarkdown(`

---

`);
      const parts = [];
      if (summary.defCount > 0) parts.push(`${summary.defCount} definition${summary.defCount !== 1 ? "s" : ""}`);
      if (summary.refCount > 0) parts.push(`${summary.refCount} reference${summary.refCount !== 1 ? "s" : ""}`);
      if (summary.deleted) parts.push("deleted");
      md.appendMarkdown(parts.join(", "));
    }
    this.appendDataflowInfo(md, name, sceneName, line, isParam);
    return new vscode4.Hover(md, range2);
  }
  labelDefinitionHover(name, sceneName, range2) {
    const md = new vscode4.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**label \`${name}\`**

`);
    const key = `${sceneName}:${name}`;
    const { gotoCount, gosubCount, scenes: refScenes } = this.labelRefIndex.get(key) ?? { gotoCount: 0, gosubCount: 0, scenes: [] };
    const total = gotoCount + gosubCount;
    if (total === 0) {
      md.appendMarkdown(`*No references found \u2014 this label may be unused*`);
    } else {
      const parts = [];
      if (gotoCount > 0) parts.push(`${gotoCount} goto${gotoCount !== 1 ? "s" : ""}`);
      if (gosubCount > 0) parts.push(`${gosubCount} gosub${gosubCount !== 1 ? "s" : ""}`);
      md.appendMarkdown(`*Referenced by:* ${parts.join(", ")}`);
      if (refScenes.length > 1) {
        md.appendMarkdown(` (from ${refScenes.map((s) => `\`${s}\``).join(", ")})`);
      }
    }
    return new vscode4.Hover(md, range2);
  }
  labelReferenceHover(name, sceneName, range2) {
    if (!this.locationIndex) return null;
    const ss = this.locationIndex.getSceneSymbols(sceneName);
    const label = ss?.labels.get(name);
    if (!label) {
      const md2 = new vscode4.MarkdownString();
      md2.appendMarkdown(`**\`${name}\`** \u2014 *label not found in \`${sceneName}\`*`);
      return new vscode4.Hover(md2, range2);
    }
    const md = new vscode4.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**goto \`${name}\`**

`);
    md.appendMarkdown(`Defined at line ${label.token.lineNumber + 1} in \`${sceneName}\``);
    return new vscode4.Hover(md, range2);
  }
  achieveHover(codename, range2) {
    if (!this.locationIndex) return null;
    const found = this.locationIndex.findAchievementDefinition(codename);
    if (!found) {
      const md2 = new vscode4.MarkdownString();
      md2.appendMarkdown(`**achieve \`${codename}\`** \u2014 *no matching \\*achievement declaration found*`);
      return new vscode4.Hover(md2, range2);
    }
    const { achievement, scene } = found;
    const md = new vscode4.MarkdownString();
    md.isTrusted = true;
    const visibility = achievement.hidden ? "invisible" : "visible";
    md.appendMarkdown(`**achieve \`${codename}\`** *(${visibility})*

`);
    md.appendMarkdown(`**Title:** ${achievement.title.content}

`);
    if (achievement.preDescription) {
      const preText = "content" in achievement.preDescription ? achievement.preDescription.content : achievement.preDescription.value;
      md.appendMarkdown(`**Pre-earned:** ${preText}

`);
    }
    md.appendMarkdown(`**Post-earned:** ${achievement.postDescription.content}

`);
    md.appendMarkdown(`---

`);
    const link = this.sceneLink(scene, achievement.token.lineNumber);
    md.appendMarkdown(`*Declared in* ${link}`);
    const refs = this.locationIndex.findAchievementReferences(codename);
    if (refs.length > 0) {
      md.appendMarkdown(` \xB7 ${refs.length} reference${refs.length !== 1 ? "s" : ""}`);
    }
    return new vscode4.Hover(md, range2);
  }
  sceneHover(name, range2) {
    if (!this.locationIndex) return null;
    const ss = this.locationIndex.getSceneSymbols(name);
    const md = new vscode4.MarkdownString();
    md.isTrusted = true;
    if (!ss) {
      md.appendMarkdown(`**scene \`${name}\`** \u2014 *not found in workspace*`);
      return new vscode4.Hover(md, range2);
    }
    md.appendMarkdown(`**scene \`${name}\`**

`);
    const labels = [...ss.labels.keys()];
    const temps = [...ss.tempVariables.keys()];
    const globalNames = [];
    for (const [varName, decl] of this.locationIndex.allGlobalDeclarations) {
      if (decl.token.sceneName === name) globalNames.push(varName);
    }
    const parts = [];
    if (labels.length > 0) {
      const shown = labels.slice(0, 8);
      const suffix = labels.length > 8 ? ` (+${labels.length - 8} more)` : "";
      parts.push(`**Labels:** ${shown.map((l) => `\`${l}\``).join(", ")}${suffix}`);
    }
    if (globalNames.length > 0) {
      const shown = globalNames.slice(0, 6);
      const suffix = globalNames.length > 6 ? ` (+${globalNames.length - 6} more)` : "";
      parts.push(`**Globals declared:** ${shown.map((v) => `\`${v}\``).join(", ")}${suffix}`);
    }
    if (temps.length > 0) {
      const shown = temps.slice(0, 6);
      const suffix = temps.length > 6 ? ` (+${temps.length - 6} more)` : "";
      parts.push(`**Temps:** ${shown.map((v) => `\`${v}\``).join(", ")}${suffix}`);
    }
    md.appendMarkdown(parts.join("\n\n"));
    return new vscode4.Hover(md, range2);
  }
  commandHover(command, range2) {
    const info = COMMAND_DOCS[command];
    if (!info) return null;
    const md = new vscode4.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**\`*${command}\`** \u2014 ${info}`);
    return new vscode4.Hover(md, range2);
  }
  hasParam(sceneName, lowerName) {
    const ss = this.locationIndex?.getSceneSymbols(sceneName);
    if (!ss) return false;
    for (const p of ss.paramVariables) {
      if (p.toLowerCase() === lowerName) return true;
    }
    return false;
  }
  findVariableSummary(lowerName) {
    for (const [key, summary] of this.symbolTable.variables) {
      if (key.toLowerCase() === lowerName) return summary;
    }
    return void 0;
  }
  findDeclaration(lowerName, currentScene) {
    if (!this.locationIndex) return null;
    const ss = this.locationIndex.getSceneSymbols(currentScene);
    if (ss) {
      for (const [key, decl] of ss.tempVariables) {
        if (key.toLowerCase() === lowerName) return decl;
      }
    }
    for (const [key, decl] of this.locationIndex.allGlobalDeclarations) {
      if (key.toLowerCase() === lowerName) return decl;
    }
    return null;
  }
};
function fileToScene(fileName) {
  return fileName.replace(/\\/g, "/").split("/").pop().replace(/\.txt$/, "");
}
var DECLARATION_KINDS = /* @__PURE__ */ new Set([
  "DeclareVariable",
  "DeclareArray",
  "Parameters"
]);
var MUTATION_KINDS = /* @__PURE__ */ new Set([
  "SetVariable",
  "InputText",
  "InputNumber",
  "GenerateRandom"
]);
function lookupVariable(state, variable, scene) {
  const name = variable.toLowerCase();
  const tempScene = state.temps[scene];
  if (tempScene && name in tempScene) return tempScene[name];
  if (name in state.globals) return state.globals[name];
  return null;
}
function formatAbstractValue(value) {
  switch (value.kind) {
    case "constant":
      return `\`${formatLiteral(value.value)}\``;
    case "set": {
      const sorted = [...value.values].sort(compareValues);
      const inputTag = value.hasUserInput ? " + user input" : "";
      if (sorted.length <= 9) {
        return `{${sorted.map((v) => formatLiteral(v)).join(", ")}}${inputTag}`;
      }
      const mid = Math.floor(sorted.length / 2);
      const picks = sampleAround(sorted, [0, mid, sorted.length - 1], 3);
      const notShown = sorted.length - picks.length;
      const parts = [];
      let last = -1;
      for (const i of picks) {
        if (last >= 0 && i > last + 1) parts.push("..");
        parts.push(formatLiteral(sorted[i]));
        last = i;
      }
      const suffix = notShown > 0 ? ` ${notShown} not shown [${formatLiteral(sorted[0])}..${formatLiteral(sorted[mid])}..${formatLiteral(sorted[sorted.length - 1])}]` : "";
      return `{${parts.join(", ")}}${suffix}${inputTag}`;
    }
    case "range":
      return `[${value.min}..${value.max}]`;
    case "input":
      return "*user input*";
    case "loop":
      return "*loop-dependent*";
    case "top":
      return "*unknown*";
    case "bottom":
      return "*uninitialized*";
  }
}
function sampleAround(arr, centres, radius) {
  const picked = /* @__PURE__ */ new Set();
  for (const c of centres) {
    for (let i = Math.max(0, c - radius + 1); i <= Math.min(arr.length - 1, c + radius - 1); i++) {
      picked.add(i);
    }
  }
  return [...picked].sort((a, b) => a - b);
}
function compareValues(a, b) {
  if (typeof a === typeof b) {
    if (typeof a === "string") return a.localeCompare(b);
    if (typeof a === "number") return a - b;
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return String(a).localeCompare(String(b));
}
var COMMAND_DOCS = {
  choice: "Present options to the player. Each `#option` is an indented child.",
  fake_choice: "Present options that don't affect variables. Continues after selection.",
  if: "Conditional branch. Body executes when expression is true.",
  elseif: "Conditional branch following `*if`. Checked when prior conditions are false.",
  else: "Fallback branch. Executes when all prior `*if`/`*elseif` are false.",
  set: "Set a variable to an expression value.",
  create: "Declare a global variable (persists across scenes).",
  temp: "Declare a temporary variable (scene-scoped).",
  goto: "Jump to a label in the current scene.",
  goto_scene: "Jump to another scene, optionally to a specific label.",
  gosub: "Call a subroutine at a label. Returns to the next line after `*return`.",
  gosub_scene: "Call a subroutine in another scene. Returns after `*return`.",
  return: "Return from a `*gosub`/`*gosub_scene` call.",
  label: "Define a named jump target for `*goto`/`*gosub`.",
  finish: "End the current scene. Advances to the next scene in `*scene_list`.",
  ending: "End the game with a final message.",
  delay_ending: "End the game with a delayed final message.",
  page_break: 'Insert a page break ("Next" button).',
  line_break: "Insert a blank line in the output.",
  input_text: "Prompt the player for text input, stored in a variable.",
  input_number: "Prompt the player for a number, stored in a variable.",
  rand: "Generate a random integer in a range and store in a variable.",
  comment: "A comment line. Not shown to the player.",
  scene_list: "Declare the ordered list of scenes for the game.",
  stat_chart: "Display a statistics chart to the player.",
  achievement: "Define an achievement with a title and description.",
  achieve: "Award an achievement to the player.",
  check_achievements: "Display the achievements screen.",
  image: "Display an image.",
  text_image: "Display an image inline with text.",
  link: "Display a clickable hyperlink.",
  selectable_if: "Make a choice option conditionally selectable.",
  hide_reuse: "Hide a choice option after it has been selected.",
  disable_reuse: "Grey out a choice option after it has been selected.",
  allow_reuse: "Allow a choice option to be selected multiple times.",
  save_checkpoint: "Save game state to a named checkpoint.",
  restore_checkpoint: "Restore game state from a named checkpoint.",
  goto_random_scene: "Jump to a randomly selected scene from a list.",
  create_array: "Declare a global array variable.",
  temp_array: "Declare a temporary array variable.",
  delete: "Delete a variable.",
  delete_array: "Delete an array variable.",
  author: "Set the game author name.",
  ifid: "Set the game's unique identifier (UUID).",
  params: "Declare parameters for a gosub-called label."
};

// src/definition.ts
var vscode5 = __toESM(require("vscode"));
var ChoiceScriptDefinitionProvider = class {
  locationIndex = null;
  folder = null;
  updateData(locationIndex, folder) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }
  provideDefinition(document, position) {
    if (!this.locationIndex || !this.folder) return null;
    const range2 = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range2) return null;
    const word = document.getText(range2);
    const line = document.lineAt(position.line).text;
    const linePrefix = line.substring(0, range2.start.character).trimStart();
    const sceneName = fileToScene2(document.fileName);
    if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      return this.labelDefinition(word, sceneName, range2);
    }
    if (/\*(goto_scene|gosub_scene)\s+\w+\s+$/i.test(linePrefix)) {
      const sceneMatch = linePrefix.match(/\*(?:goto_scene|gosub_scene)\s+(\w+)\s+$/i);
      const targetScene = sceneMatch?.[1];
      if (targetScene) return this.labelDefinition(word, targetScene, range2);
    }
    if (/\*(goto_scene|gosub_scene)\s+$/i.test(linePrefix)) {
      return this.sceneDefinition(word, range2);
    }
    if (/\*achieve\s+$/i.test(linePrefix)) {
      return this.achievementDefinition(word, range2);
    }
    return this.variableDefinition(word, sceneName, range2);
  }
  variableDefinition(name, sceneName, originRange) {
    if (!this.locationIndex || !this.folder) return null;
    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (ss) {
      const temp = ss.tempVariables.get(name);
      if (temp) {
        const token = temp.token;
        const varToken = temp.variable;
        const uri = vscode5.Uri.joinPath(this.folder, `${token.sceneName}.txt`);
        const targetRange = new vscode5.Range(
          varToken.lineNumber,
          varToken.position,
          varToken.lineNumber,
          varToken.position + varToken.value.length
        );
        return [{ originSelectionRange: originRange, targetUri: uri, targetRange, targetSelectionRange: targetRange }];
      }
    }
    const global = this.locationIndex.getGlobalDeclaration(name);
    if (global) {
      const token = global.token;
      const varToken = global.variable;
      const uri = vscode5.Uri.joinPath(this.folder, `${token.sceneName}.txt`);
      const targetRange = new vscode5.Range(
        varToken.lineNumber,
        varToken.position,
        varToken.lineNumber,
        varToken.position + varToken.value.length
      );
      return [{ originSelectionRange: originRange, targetUri: uri, targetRange, targetSelectionRange: targetRange }];
    }
    return null;
  }
  labelDefinition(labelName, sceneName, originRange) {
    if (!this.locationIndex || !this.folder) return null;
    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (!ss) return null;
    const lowerName = labelName.toLowerCase();
    let label = ss.labels.get(labelName);
    if (!label) {
      for (const [key, stmt] of ss.labels) {
        if (key.toLowerCase() === lowerName) {
          label = stmt;
          break;
        }
      }
    }
    if (!label) return null;
    const targetLine = label.label.lineNumber;
    const targetCol = label.label.position;
    const uri = vscode5.Uri.joinPath(this.folder, `${sceneName}.txt`);
    const targetRange = new vscode5.Range(targetLine, targetCol, targetLine, targetCol + label.label.value.length);
    return [{
      originSelectionRange: originRange,
      targetUri: uri,
      targetRange,
      targetSelectionRange: targetRange
    }];
  }
  achievementDefinition(codename, originRange) {
    if (!this.locationIndex || !this.folder) return null;
    const found = this.locationIndex.findAchievementDefinition(codename);
    if (!found) return null;
    const tok = found.achievement.codename;
    const uri = vscode5.Uri.joinPath(this.folder, `${found.scene}.txt`);
    const targetRange = new vscode5.Range(tok.lineNumber, tok.position, tok.lineNumber, tok.position + tok.value.length);
    return [{
      originSelectionRange: originRange,
      targetUri: uri,
      targetRange,
      targetSelectionRange: targetRange
    }];
  }
  sceneDefinition(sceneName, originRange) {
    if (!this.locationIndex || !this.folder) return null;
    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (!ss) return null;
    const uri = vscode5.Uri.joinPath(this.folder, `${sceneName}.txt`);
    const targetRange = new vscode5.Range(0, 0, 0, 0);
    return [{
      originSelectionRange: originRange,
      targetUri: uri,
      targetRange,
      targetSelectionRange: targetRange
    }];
  }
};
function fileToScene2(fileName) {
  return fileName.replace(/\\/g, "/").split("/").pop().replace(/\.txt$/, "");
}

// src/folding.ts
var vscode6 = __toESM(require("vscode"));
var ChoiceScriptFoldingProvider = class {
  provideFoldingRanges(document) {
    const ranges = [];
    const lineCount = document.lineCount;
    const info = (i) => {
      const text = document.lineAt(i).text;
      const trimmed = text.trimStart();
      const indent = trimmed.length === 0 ? -1 : text.length - trimmed.length;
      return { text, trimmed, indent };
    };
    const findBlockEnd = (start, startIndent) => {
      let end = start;
      for (let j = start + 1; j < lineCount; j++) {
        const { indent } = info(j);
        if (indent === -1) continue;
        if (indent <= startIndent) break;
        end = j;
      }
      return end;
    };
    const ifPattern = /^\*if\b/i;
    const elseIfPattern = /^\*elseif\b/i;
    const elsePattern = /^\*else\b/i;
    const labelPattern = /^\*label\b/i;
    const choicePattern = /^\*(?:choice|fake_choice)\b/i;
    const blockPattern = /^\*(?:label|stat_chart|scene_list|achievement)\b/i;
    const optionPattern = /^(?:#|\*(?:selectable_if|hide_reuse|disable_reuse|allow_reuse)\b)/i;
    const labelLines = [];
    for (let i = 0; i < lineCount; i++) {
      const { trimmed } = info(i);
      if (labelPattern.test(trimmed)) labelLines.push(i);
    }
    for (let k = 0; k < labelLines.length; k++) {
      const start = labelLines[k];
      let end;
      if (k + 1 < labelLines.length) {
        end = labelLines[k + 1] - 1;
        while (end > start && info(end).indent === -1) end--;
      } else {
        end = lineCount - 1;
        while (end > start && info(end).indent === -1) end--;
      }
      if (end > start) {
        ranges.push(new vscode6.FoldingRange(start, end, vscode6.FoldingRangeKind.Region));
      }
    }
    const handled = /* @__PURE__ */ new Set();
    for (let i = 0; i < lineCount; i++) {
      if (handled.has(i)) continue;
      const { trimmed, indent } = info(i);
      if (indent === -1) continue;
      if (ifPattern.test(trimmed)) {
        const branches = [];
        let chainEnd = findBlockEnd(i, indent);
        let j = chainEnd + 1;
        while (j < lineCount) {
          const next = info(j);
          if (next.indent === -1) {
            j++;
            continue;
          }
          if (next.indent !== indent) break;
          if (elseIfPattern.test(next.trimmed) || elsePattern.test(next.trimmed)) {
            handled.add(j);
            branches.push(j);
            const branchEnd = findBlockEnd(j, indent);
            chainEnd = branchEnd;
            j = branchEnd + 1;
            if (elsePattern.test(next.trimmed)) break;
          } else {
            break;
          }
        }
        if (chainEnd > i) {
          ranges.push(new vscode6.FoldingRange(i, chainEnd));
          for (const branchLine of branches) {
            ranges.push(new vscode6.FoldingRange(branchLine, chainEnd));
          }
        }
        continue;
      }
      if (choicePattern.test(trimmed)) {
        const end = findBlockEnd(i, indent);
        if (end > i) {
          ranges.push(new vscode6.FoldingRange(i, end));
        }
        continue;
      }
      if (blockPattern.test(trimmed) || optionPattern.test(trimmed)) {
        const end = findBlockEnd(i, indent);
        if (end > i) {
          ranges.push(new vscode6.FoldingRange(i, end));
        }
      }
    }
    return ranges;
  }
};

// src/inline-hints.ts
var vscode7 = __toESM(require("vscode"));
var hintStyle = {
  after: {
    color: new vscode7.ThemeColor("editorCodeLens.foreground"),
    fontStyle: "italic",
    margin: "0 0 0 2em"
  },
  rangeBehavior: vscode7.DecorationRangeBehavior.ClosedClosed
};
var InlineHintDecorator = class {
  decorationType = vscode7.window.createTextEditorDecorationType(hintStyle);
  disposables = [];
  scenes = [];
  enabled = true;
  activate(context) {
    this.disposables.push(this.decorationType);
    this.disposables.push(
      vscode7.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === "choicescript") {
          this.update(editor);
        }
      })
    );
    this.disposables.push(
      vscode7.workspace.onDidChangeTextDocument((e) => {
        const editor = vscode7.window.activeTextEditor;
        if (editor && e.document === editor.document && e.document.languageId === "choicescript") {
          this.update(editor);
        }
      })
    );
    this.disposables.push(
      vscode7.workspace.onDidOpenTextDocument((doc) => {
        const editor = vscode7.window.activeTextEditor;
        if (editor && editor.document === doc && doc.languageId === "choicescript") {
          this.update(editor);
        }
      })
    );
    context.subscriptions.push(...this.disposables);
    if (vscode7.window.activeTextEditor?.document.languageId === "choicescript") {
      this.update(vscode7.window.activeTextEditor);
    }
  }
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  updateScenes(scenes) {
    this.scenes = scenes;
  }
  update(editor) {
    const doc = editor.document;
    const decorations = [];
    const choicePattern = /^\s*\*(?:choice|fake_choice)\s*$/i;
    const sceneName = doc.uri.path.split("/").pop()?.replace(/\.txt$/, "") ?? "";
    const sceneAst = this.scenes.find((s) => s.name === sceneName);
    if (this.enabled) {
      const conditionHints = sceneAst ? buildConditionHintMap(sceneAst.statements) : /* @__PURE__ */ new Map();
      const elseIfPattern = /^\s*\*elseif\b/i;
      const elsePattern = /^\s*\*else\s*$/i;
      for (let i = 0; i < doc.lineCount; i++) {
        const line = doc.lineAt(i);
        const text = line.text;
        const trimmed = text.trimStart();
        if (trimmed.length === 0) continue;
        if (elseIfPattern.test(text) || elsePattern.test(text)) {
          const hint = conditionHints.get(i);
          if (hint) {
            decorations.push({
              range: new vscode7.Range(i, text.length, i, text.length),
              renderOptions: { after: { contentText: `  ${hint}` } }
            });
          }
        }
      }
    }
    if (this.enabled && sceneAst) {
      const structureHints = buildStructureHintMap(sceneAst.statements);
      for (const [lineNum, hint] of structureHints) {
        if (lineNum >= doc.lineCount) continue;
        const text = doc.lineAt(lineNum).text;
        decorations.push({
          range: new vscode7.Range(lineNum, text.length, lineNum, text.length),
          renderOptions: { after: { contentText: `  ${hint}` } }
        });
      }
    }
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const text = line.text;
      const trimmed = text.trimStart();
      if (trimmed.length === 0) continue;
      if (choicePattern.test(text)) {
        const prose = findPrecedingProse(doc, i);
        if (prose) {
          const truncated = prose.length > 80 ? prose.substring(0, 77) + "..." : prose;
          decorations.push({
            range: new vscode7.Range(i, line.text.length, i, line.text.length),
            renderOptions: { after: { contentText: `  "${truncated}"` } }
          });
        }
      }
    }
    editor.setDecorations(this.decorationType, decorations);
  }
};
function buildConditionHintMap(statements) {
  const map = /* @__PURE__ */ new Map();
  walkStatements(statements, map);
  return map;
}
function walkStatements(statements, map) {
  for (const stmt of statements) {
    if (stmt.kind === "If") {
      const ifStmt = stmt;
      walkStatements(ifStmt.body, map);
      for (const branch of ifStmt.elseIfBranches) {
        if (branch.effectiveCondition) {
          map.set(branch.token.lineNumber, stringifyExpression(branch.effectiveCondition));
        }
        walkStatements(branch.body, map);
      }
      if (ifStmt.elseBranch) {
        const elseBranch = ifStmt.elseBranch;
        if (elseBranch.invertedCondition) {
          const line = elseBranch.token.lineNumber;
          map.set(line, stringifyExpression(elseBranch.invertedCondition));
        }
        walkStatements(elseBranch.body, map);
      }
    } else if (stmt.kind === "Choice" || stmt.kind === "FakeChoice") {
      walkStatements(stmt.body, map);
    } else if (stmt.kind === "ChoiceOption") {
      walkStatements(stmt.body, map);
    }
  }
}
function buildStructureHintMap(statements) {
  const map = /* @__PURE__ */ new Map();
  for (const stmt of statements) {
    if (stmt.kind === "Achievement") {
      const a = stmt;
      if (a.preDescription) {
        const line = "lineNumber" in a.preDescription ? a.preDescription.lineNumber : a.preDescription.lineNumber;
        if (typeof line === "number") {
          map.set(line, "\u2190 pre-earn description");
        }
      }
      if (a.postDescription) {
        map.set(a.postDescription.lineNumber, "\u2190 post-earn description");
      }
    }
    if (stmt.kind === "Image" || stmt.kind === "TextImage") {
      const img = stmt;
      const parts = [];
      if (img.alignment) parts.push(`align: ${img.alignment.value}`);
      if (img.altText) {
        const alt = img.altText.content.length > 40 ? img.altText.content.substring(0, 37) + "..." : img.altText.content;
        parts.push(`alt: "${alt}"`);
      }
      if (parts.length > 0) {
        map.set(img.token.lineNumber, `\u2190 ${parts.join(", ")}`);
      }
    }
  }
  return map;
}
function findPrecedingProse(doc, choiceLine) {
  for (let k = choiceLine - 1; k >= 0; k--) {
    const text = doc.lineAt(k).text;
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("*")) return null;
    return trimmed;
  }
  return null;
}

// src/references.ts
var vscode8 = __toESM(require("vscode"));
var ChoiceScriptReferenceProvider = class {
  locationIndex = null;
  folder = null;
  updateData(locationIndex, folder) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }
  provideReferences(document, position, _context) {
    if (!this.locationIndex || !this.folder) return null;
    const range2 = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range2) return null;
    const word = document.getText(range2);
    const line = document.lineAt(position.line).text;
    const linePrefix = line.substring(0, range2.start.character).trimStart();
    const sceneName = fileToScene3(document.fileName);
    if (/\*label\s+$/i.test(linePrefix)) {
      return this.labelReferences(word, sceneName);
    }
    if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      return this.labelReferences(word, sceneName);
    }
    if (/\*(goto_scene|gosub_scene)\s+\w+\s+$/i.test(linePrefix)) {
      const match = linePrefix.match(/\*(?:goto_scene|gosub_scene)\s+(\w+)\s+$/i);
      if (match) return this.labelReferences(word, match[1]);
    }
    if (/\*(achieve|achievement)\s+$/i.test(linePrefix)) {
      return this.achievementReferences(word);
    }
    return this.variableReferences(word, sceneName);
  }
  variableReferences(name, sceneName) {
    if (!this.locationIndex || !this.folder) return null;
    const isTempOnly2 = this.isTempOnly(name, sceneName);
    const occurrences = this.locationIndex.queryIdentifier(name);
    if (occurrences.length === 0) return null;
    const locations = [];
    const seen = /* @__PURE__ */ new Set();
    for (const occ of occurrences) {
      if (isTempOnly2 && occ.scene !== sceneName) continue;
      const key = `${occ.scene}:${occ.line}:${occ.position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const uri = vscode8.Uri.joinPath(this.folder, `${occ.scene}.txt`);
      const range2 = new vscode8.Range(occ.line, occ.position, occ.line, occ.position + occ.length);
      locations.push(new vscode8.Location(uri, range2));
    }
    return locations.length > 0 ? locations : null;
  }
  isTempOnly(name, sceneName) {
    if (!this.locationIndex) return false;
    const ss = this.locationIndex.getSceneSymbols(sceneName);
    if (!ss || !ss.tempVariables.has(name.toLowerCase())) return false;
    return !this.locationIndex.getGlobalDeclaration(name);
  }
  labelReferences(labelName, inScene) {
    if (!this.locationIndex || !this.folder) return null;
    const locations = [];
    const lower = labelName.toLowerCase();
    for (const sceneName of this.locationIndex.allSceneNames) {
      const ss = this.locationIndex.getSceneSymbols(sceneName);
      if (!ss) continue;
      for (const [name, label] of ss.labels) {
        if (name.toLowerCase() === lower && sceneName === inScene) {
          const uri = vscode8.Uri.joinPath(this.folder, `${sceneName}.txt`);
          locations.push(new vscode8.Location(uri, new vscode8.Position(label.label.lineNumber, label.label.position)));
        }
      }
      for (const goto of ss.gotos) {
        const ref = extractLabelRef2(goto, lower, inScene);
        if (ref) {
          const uri = vscode8.Uri.joinPath(this.folder, `${sceneName}.txt`);
          locations.push(new vscode8.Location(uri, new vscode8.Position(ref.line, ref.position)));
        }
      }
      for (const gosub of ss.gosubs) {
        const ref = extractLabelRef2(gosub, lower, inScene);
        if (ref) {
          const uri = vscode8.Uri.joinPath(this.folder, `${sceneName}.txt`);
          locations.push(new vscode8.Location(uri, new vscode8.Position(ref.line, ref.position)));
        }
      }
    }
    return locations.length > 0 ? locations : null;
  }
  achievementReferences(codename) {
    if (!this.locationIndex || !this.folder) return null;
    const locations = [];
    const def = this.locationIndex.findAchievementDefinition(codename);
    if (def) {
      const tok = def.achievement.codename;
      const uri = vscode8.Uri.joinPath(this.folder, `${def.scene}.txt`);
      locations.push(new vscode8.Location(uri, new vscode8.Range(tok.lineNumber, tok.position, tok.lineNumber, tok.position + tok.value.length)));
    }
    for (const ref of this.locationIndex.findAchievementReferences(codename)) {
      const uri = vscode8.Uri.joinPath(this.folder, `${ref.scene}.txt`);
      locations.push(new vscode8.Location(uri, new vscode8.Range(ref.line, ref.position, ref.line, ref.position + ref.length)));
    }
    return locations.length > 0 ? locations : null;
  }
};
function extractLabelRef2(stmt, lowerLabel, targetScene) {
  if (stmt.kind === "GotoLabel" || stmt.kind === "GoSub") {
    const label = stmt.label;
    if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
      return { line: label.lineNumber, position: label.position };
    }
  }
  if (stmt.kind === "GotoScene" || stmt.kind === "GoSubScene") {
    const scene = stmt.scene;
    const label = stmt.label;
    if (scene && "value" in scene && scene.value.toLowerCase() === targetScene.toLowerCase()) {
      if (label && "value" in label && label.value.toLowerCase() === lowerLabel) {
        return { line: label.lineNumber, position: label.position };
      }
    }
  }
  return null;
}
function fileToScene3(fileName) {
  return fileName.replace(/\\/g, "/").split("/").pop().replace(/\.txt$/, "");
}

// src/rename.ts
var vscode9 = __toESM(require("vscode"));
var ChoiceScriptRenameProvider = class {
  locationIndex = null;
  folder = null;
  updateData(locationIndex, folder) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }
  prepareRename(document, position) {
    if (!this.locationIndex) return null;
    const range2 = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range2) return null;
    const word = document.getText(range2);
    const ctx = this.classifyCursor(document, position, range2);
    if (!ctx) return null;
    if (ctx.kind === "label") {
      const ss = this.locationIndex.getSceneSymbols(ctx.scene);
      if (!ss) return null;
      const hasLabel = [...ss.labels.keys()].some(
        (k) => k.toLowerCase() === word.toLowerCase()
      );
      if (!hasLabel) return null;
    } else if (ctx.kind === "achievement") {
      if (!this.locationIndex.findAchievementDefinition(word)) return null;
    } else {
      const occs = this.locationIndex.queryIdentifier(word);
      if (occs.length === 0) return null;
    }
    return range2;
  }
  provideRenameEdits(document, position, newName) {
    if (!this.locationIndex || !this.folder) return null;
    const range2 = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!range2) return null;
    const word = document.getText(range2);
    const ctx = this.classifyCursor(document, position, range2);
    if (!ctx) return null;
    const result = ctx.kind === "label" ? computeLabelRename(this.locationIndex, word, newName, ctx.scene) : ctx.kind === "achievement" ? computeAchievementRename(this.locationIndex, word, newName) : computeVariableRename(this.locationIndex, word, newName, ctx.scene);
    if (result.edits.length === 0) return null;
    return this.toWorkspaceEdit(result.edits);
  }
  classifyCursor(document, position, range2) {
    const line = document.lineAt(position.line).text;
    const linePrefix = line.substring(0, range2.start.character).trimStart();
    const sceneName = fileToScene4(document.fileName);
    if (/\*label\s+$/i.test(linePrefix)) {
      return { kind: "label", scene: sceneName };
    }
    if (/\*(goto|gosub)\s+$/i.test(linePrefix)) {
      return { kind: "label", scene: sceneName };
    }
    if (/\*(goto_scene|gosub_scene)\s+(\w+)\s+$/i.test(linePrefix)) {
      const match = linePrefix.match(/\*(?:goto_scene|gosub_scene)\s+(\w+)\s+$/i);
      if (match) return { kind: "label", scene: match[1] };
    }
    if (/\*(achieve|achievement)\s+$/i.test(linePrefix)) {
      return { kind: "achievement", scene: sceneName };
    }
    return { kind: "variable", scene: sceneName };
  }
  toWorkspaceEdit(edits) {
    const wsEdit = new vscode9.WorkspaceEdit();
    for (const edit of edits) {
      const uri = vscode9.Uri.joinPath(this.folder, `${edit.scene}.txt`);
      const range2 = new vscode9.Range(
        edit.line,
        edit.position,
        edit.line,
        edit.position + edit.length
      );
      wsEdit.replace(uri, range2, edit.newText);
    }
    return wsEdit;
  }
};
function fileToScene4(fileName) {
  return fileName.replace(/\\/g, "/").split("/").pop().replace(/\.txt$/, "");
}

// src/symbols.ts
var vscode10 = __toESM(require("vscode"));
var ChoiceScriptDocumentSymbolProvider = class {
  locationIndex = null;
  updateData(locationIndex) {
    this.locationIndex = locationIndex;
  }
  provideDocumentSymbols(document) {
    if (!this.locationIndex) return null;
    const scene = fileToScene5(document.fileName);
    const ss = this.locationIndex.getSceneSymbols(scene);
    if (!ss) return null;
    const symbols = [];
    for (const [name, label] of ss.labels) {
      const line = label.label.lineNumber;
      const pos = label.label.position;
      const range2 = new vscode10.Range(line, 0, line, pos + name.length);
      const selRange = new vscode10.Range(line, pos, line, pos + name.length);
      symbols.push(new vscode10.DocumentSymbol(
        name,
        "label",
        vscode10.SymbolKind.Key,
        range2,
        selRange
      ));
    }
    for (const [name, decl] of ss.tempVariables) {
      const tok = decl.variable;
      const line = tok.lineNumber;
      const pos = tok.position;
      const range2 = new vscode10.Range(line, 0, line, pos + name.length);
      const selRange = new vscode10.Range(line, pos, line, pos + name.length);
      symbols.push(new vscode10.DocumentSymbol(
        name,
        "temp",
        vscode10.SymbolKind.Variable,
        range2,
        selRange
      ));
    }
    for (const [name, achievement] of ss.achievements) {
      const tok = achievement.codename;
      const line = tok.lineNumber;
      const pos = tok.position;
      const range2 = new vscode10.Range(line, 0, line, pos + tok.value.length);
      const selRange = new vscode10.Range(line, pos, line, pos + tok.value.length);
      symbols.push(new vscode10.DocumentSymbol(
        tok.value,
        "achievement",
        vscode10.SymbolKind.Event,
        range2,
        selRange
      ));
    }
    const globalDecls = this.locationIndex.allGlobalDeclarations;
    for (const [name, decl] of globalDecls) {
      if (decl.token.sceneName !== scene) continue;
      const tok = decl.variable;
      const line = tok.lineNumber;
      const pos = tok.position;
      const range2 = new vscode10.Range(line, 0, line, pos + name.length);
      const selRange = new vscode10.Range(line, pos, line, pos + name.length);
      symbols.push(new vscode10.DocumentSymbol(
        name,
        "global",
        vscode10.SymbolKind.Variable,
        range2,
        selRange
      ));
    }
    symbols.sort((a, b) => a.range.start.line - b.range.start.line);
    return symbols.length > 0 ? symbols : null;
  }
};
var ChoiceScriptWorkspaceSymbolProvider = class {
  locationIndex = null;
  folder = null;
  updateData(locationIndex, folder) {
    this.locationIndex = locationIndex;
    this.folder = folder;
  }
  provideWorkspaceSymbols(query) {
    if (!this.locationIndex || !this.folder) return null;
    const lower = query.toLowerCase();
    const symbols = [];
    for (const sceneName of this.locationIndex.allSceneNames) {
      const ss = this.locationIndex.getSceneSymbols(sceneName);
      if (!ss) continue;
      const uri = vscode10.Uri.joinPath(this.folder, `${sceneName}.txt`);
      for (const [name, label] of ss.labels) {
        if (lower && !name.toLowerCase().includes(lower)) continue;
        const pos = new vscode10.Position(label.label.lineNumber, label.label.position);
        symbols.push(new vscode10.SymbolInformation(
          name,
          vscode10.SymbolKind.Key,
          sceneName,
          new vscode10.Location(uri, pos)
        ));
      }
      for (const [, achievement] of ss.achievements) {
        const codename = achievement.codename.value;
        if (lower && !codename.toLowerCase().includes(lower)) continue;
        const pos = new vscode10.Position(achievement.codename.lineNumber, achievement.codename.position);
        symbols.push(new vscode10.SymbolInformation(
          codename,
          vscode10.SymbolKind.Event,
          sceneName,
          new vscode10.Location(uri, pos)
        ));
      }
      for (const [name, decl] of ss.tempVariables) {
        if (lower && !name.toLowerCase().includes(lower)) continue;
        const pos = new vscode10.Position(decl.variable.lineNumber, decl.variable.position);
        symbols.push(new vscode10.SymbolInformation(
          name,
          vscode10.SymbolKind.Variable,
          `${sceneName} (temp)`,
          new vscode10.Location(uri, pos)
        ));
      }
    }
    const globalDecls = this.locationIndex.allGlobalDeclarations;
    for (const [name, decl] of globalDecls) {
      if (lower && !name.toLowerCase().includes(lower)) continue;
      const uri = vscode10.Uri.joinPath(this.folder, `${decl.token.sceneName}.txt`);
      const pos = new vscode10.Position(decl.variable.lineNumber, decl.variable.position);
      symbols.push(new vscode10.SymbolInformation(
        name,
        vscode10.SymbolKind.Variable,
        "global",
        new vscode10.Location(uri, pos)
      ));
    }
    return symbols.length > 0 ? symbols : null;
  }
};
function fileToScene5(fileName) {
  return fileName.replace(/\\/g, "/").split("/").pop().replace(/\.txt$/, "");
}

// src/language-detection.ts
var vscode11 = __toESM(require("vscode"));
async function detectChoiceScriptFolders() {
  const results = [];
  const startupFiles = await vscode11.workspace.findFiles("**/startup.txt", "**/node_modules/**");
  for (const startupUri of startupFiles) {
    const folder = vscode11.Uri.joinPath(startupUri, "..");
    if (!results.some((r) => r.toString() === folder.toString())) {
      results.push(folder);
    }
  }
  return results;
}
function isInFolder(docUri, folder) {
  const docStr = docUri.toString();
  const folderStr = folder.toString().replace(/\/?$/, "/");
  return docStr.startsWith(folderStr);
}
async function setLanguageForFolder(folder) {
  for (const doc of vscode11.workspace.textDocuments) {
    if (doc.languageId !== "plaintext") continue;
    if (!doc.fileName.endsWith(".txt")) continue;
    if (!isInFolder(doc.uri, folder)) continue;
    await vscode11.languages.setTextDocumentLanguage(doc, "choicescript");
  }
}
function watchStartupFile(context, onDetected, onRemoved) {
  const watcher = vscode11.workspace.createFileSystemWatcher("**/startup.txt");
  watcher.onDidCreate((uri) => {
    const folder = vscode11.Uri.joinPath(uri, "..");
    onDetected(folder);
  });
  watcher.onDidDelete((uri) => {
    const folder = vscode11.Uri.joinPath(uri, "..");
    onRemoved(folder);
  });
  context.subscriptions.push(watcher);
}

// src/code-actions.ts
var vscode12 = __toESM(require("vscode"));
var ChoiceScriptCodeActionProvider = class {
  static providedCodeActionKinds = [vscode12.CodeActionKind.QuickFix];
  provideCodeActions(document, _range, context) {
    const actions = [];
    for (const diag of context.diagnostics) {
      if (diag.source !== "choicescript") continue;
      if (diag.code === "multiline-multireplace") {
        const fix = this.fixMultilineMultireplace(document, diag);
        if (fix) actions.push(fix);
      }
      if (diag.code === "label-wrong-scene") {
        actions.push(...this.fixLabelWrongScene(document, diag));
      }
    }
    return actions;
  }
  fixMultilineMultireplace(document, diag) {
    const range2 = diag.range;
    const text = document.getText(range2);
    if (!text.includes("\n")) return void 0;
    const joined = text.replace(/\n\s*/g, " ");
    const action = new vscode12.CodeAction(
      "Join multireplace onto a single line",
      vscode12.CodeActionKind.QuickFix
    );
    action.edit = new vscode12.WorkspaceEdit();
    action.edit.replace(document.uri, range2, joined);
    action.diagnostics = [diag];
    action.isPreferred = true;
    return action;
  }
  fixLabelWrongScene(document, diag) {
    const fixData = diag._fixData;
    if (!fixData?.suggestions?.length) return [];
    return fixData.suggestions.map((scene, i) => {
      const action = new vscode12.CodeAction(
        `Change scene to "${scene}"`,
        vscode12.CodeActionKind.QuickFix
      );
      action.edit = new vscode12.WorkspaceEdit();
      action.edit.replace(document.uri, fixData.sceneRange, scene);
      action.diagnostics = [diag];
      if (i === 0) action.isPreferred = true;
      return action;
    });
  }
};

// src/extension.ts
var selector = { language: "choicescript" };
var activeFolders = [];
var analysers = /* @__PURE__ */ new Map();
var analysisTimer;
var diagnosticCollection;
var semanticProvider;
var hoverProvider;
var definitionProvider;
var referenceProvider;
var renameProvider;
var documentSymbolProvider;
var workspaceSymbolProvider;
var inlineHints;
var statusBar;
function scheduleAnalysis() {
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisTimer = setTimeout(runFullAnalysis, 300);
}
function getAnalyser(folder) {
  const key = folder.toString();
  let analyser = analysers.get(key);
  if (!analyser) {
    analyser = new WorkspaceAnalyser();
    analysers.set(key, analyser);
  }
  return analyser;
}
async function runFullAnalysis() {
  statusBar.text = "$(sync~spin) ChoiceScript Tree";
  statusBar.tooltip = "Analysing workspace\u2026";
  const startTime = Date.now();
  try {
    await Promise.all(activeFolders.map(async (folder) => {
      try {
        const config = vscode13.workspace.getConfiguration("choicescript");
        const showConditionHints = config.get("showConditionHints", true);
        const analyser = getAnalyser(folder);
        const result = await analyser.analyse(folder, {
          computeConditionHints: showConditionHints,
          onStage: (stage) => {
            statusBar.text = `$(sync~spin) ChoiceScript Tree: ${stage}`;
          }
        });
        await pushDiagnostics(diagnosticCollection, folder, result);
        semanticProvider.updateContext(result.knownLabels, result.sceneNames, result.locationIndex);
        hoverProvider.updateData(
          result.symbolTable,
          result.locationIndex,
          folder
        );
        definitionProvider.updateData(result.locationIndex, folder);
        referenceProvider.updateData(result.locationIndex, folder);
        renameProvider.updateData(result.locationIndex, folder);
        documentSymbolProvider.updateData(result.locationIndex);
        workspaceSymbolProvider.updateData(result.locationIndex, folder);
        inlineHints.setEnabled(showConditionHints);
        inlineHints.updateScenes(result.scenes);
        const editor = vscode13.window.activeTextEditor;
        if (editor?.document.languageId === "choicescript") {
          inlineHints.update(editor);
        }
      } catch (e) {
        console.error("ChoiceScript analysis failed:", e);
      }
    }));
    const elapsed = Date.now() - startTime;
    statusBar.text = "$(check) ChoiceScript Tree";
    statusBar.tooltip = `Analysis complete (${elapsed}ms)`;
  } catch (e) {
    statusBar.text = "$(error) ChoiceScript Tree";
    statusBar.tooltip = "Analysis failed";
  }
}
async function handleFolderDetected(folder) {
  if (!activeFolders.some((f) => f.toString() === folder.toString())) {
    activeFolders.push(folder);
  }
  await setLanguageForFolder(folder);
  scheduleAnalysis();
}
function handleFolderRemoved(folder) {
  const key = folder.toString();
  activeFolders = activeFolders.filter((f) => f.toString() !== key);
  const analyser = analysers.get(key);
  if (analyser) {
    analyser.reset();
    analysers.delete(key);
  }
  diagnosticCollection.clear();
}
async function activate(context) {
  diagnosticCollection = vscode13.languages.createDiagnosticCollection("choicescript");
  context.subscriptions.push(diagnosticCollection);
  semanticProvider = new ChoiceScriptSemanticTokensProvider();
  context.subscriptions.push(
    vscode13.languages.registerDocumentSemanticTokensProvider(
      selector,
      semanticProvider,
      legend
    )
  );
  hoverProvider = new ChoiceScriptHoverProvider();
  context.subscriptions.push(
    vscode13.languages.registerHoverProvider(selector, hoverProvider)
  );
  definitionProvider = new ChoiceScriptDefinitionProvider();
  context.subscriptions.push(
    vscode13.languages.registerDefinitionProvider(selector, definitionProvider)
  );
  referenceProvider = new ChoiceScriptReferenceProvider();
  context.subscriptions.push(
    vscode13.languages.registerReferenceProvider(selector, referenceProvider)
  );
  renameProvider = new ChoiceScriptRenameProvider();
  context.subscriptions.push(
    vscode13.languages.registerRenameProvider(selector, renameProvider)
  );
  documentSymbolProvider = new ChoiceScriptDocumentSymbolProvider();
  context.subscriptions.push(
    vscode13.languages.registerDocumentSymbolProvider(selector, documentSymbolProvider)
  );
  workspaceSymbolProvider = new ChoiceScriptWorkspaceSymbolProvider();
  context.subscriptions.push(
    vscode13.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
  );
  context.subscriptions.push(
    vscode13.languages.registerFoldingRangeProvider(selector, new ChoiceScriptFoldingProvider())
  );
  context.subscriptions.push(
    vscode13.languages.registerCodeActionsProvider(
      selector,
      new ChoiceScriptCodeActionProvider(),
      { providedCodeActionKinds: ChoiceScriptCodeActionProvider.providedCodeActionKinds }
    )
  );
  inlineHints = new InlineHintDecorator();
  inlineHints.activate(context);
  statusBar = vscode13.window.createStatusBarItem(vscode13.StatusBarAlignment.Left, 0);
  statusBar.text = "$(circle-outline) ChoiceScript Tree";
  statusBar.tooltip = "Waiting for analysis\u2026";
  statusBar.command = "choicescript.analyseWorkspace";
  statusBar.show();
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    vscode13.commands.registerCommand("choicescript.setLanguageMode", async () => {
      const editor = vscode13.window.activeTextEditor;
      if (editor) {
        await vscode13.languages.setTextDocumentLanguage(
          editor.document,
          "choicescript"
        );
      }
    })
  );
  context.subscriptions.push(
    vscode13.commands.registerCommand("choicescript.analyseWorkspace", () => {
      runFullAnalysis();
    })
  );
  context.subscriptions.push(
    vscode13.commands.registerCommand("choicescript.clearCache", () => {
      for (const analyser of analysers.values()) {
        analyser.reset();
      }
      diagnosticCollection.clear();
      semanticProvider.updateContext([], [], null);
      vscode13.window.showInformationMessage("ChoiceScript cache cleared. Re-analysing\u2026");
      runFullAnalysis();
    })
  );
  context.subscriptions.push(
    vscode13.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "choicescript") {
        scheduleAnalysis();
      }
    })
  );
  context.subscriptions.push(
    vscode13.workspace.onDidOpenTextDocument(async (doc) => {
      if (doc.languageId === "plaintext" && doc.fileName.endsWith(".txt")) {
        if (activeFolders.some((f) => isInFolder(doc.uri, f))) {
          await vscode13.languages.setTextDocumentLanguage(doc, "choicescript");
        }
      }
    })
  );
  const config = vscode13.workspace.getConfiguration("choicescript");
  if (config.get("autoDetect", true)) {
    const folders = await detectChoiceScriptFolders();
    for (const folder of folders) {
      await handleFolderDetected(folder);
    }
    watchStartupFile(context, handleFolderDetected, handleFolderRemoved);
  }
}
function deactivate() {
  if (analysisTimer) clearTimeout(analysisTimer);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
