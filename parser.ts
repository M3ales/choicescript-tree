import { Token } from "./tokens/token";
import {Scene} from "./tokens/scene";
import {TokenParser} from "./tokens/token-parser";
import {commentParser} from "./tokens/comment";
import {setVariableParser} from "./tokens/set-variable";
import {createCommandParser} from "./tokens/create-command";
import {stringLiteralParser} from "./tokens/string-literal";
import {variableReferenceParser} from "./tokens/variable-reference";
export interface Label extends Token {
    name: string;
    type: 'Label';
}

export interface GotoLabel extends Token {
    target: string;
    type: 'GotoLabel';
}

export interface GotoScene extends Token {
    target: string;
    targetLabel: string;
    type: 'GotoScene';
}

export interface Prose extends Token {
    content: string;
    type: 'Prose';
}

export interface Finish extends Token {
    type: 'Finish';
}

export interface CreateTempVariable extends Token {
    name: string;
    value: string | number | boolean;
    type: 'CreateTempVariable';
}

export interface SelectableIf extends Token {
    expression: string;
    type: 'SelectableIf';
}

export interface If extends Token {
    expression: string;
    type: 'If';
}

export interface ElseIf extends Token {
    expression: string;
    type: 'ElseIf';
}

export interface Else extends Token {
    type: 'Else';
}

export interface Choice extends Token {
    type: 'Choice';
    title: string;
}

export interface Option extends Token {
    type: 'Option';
    text: string;
}

export interface FakeChoice extends Token {
    type: 'FakeChoice';
}

export interface SceneStart extends Token {
    type: 'SceneStart';
}
export interface SceneEnd extends Token {
    type: 'SceneEnd';
}
export const tokeniseScenes = async (scenes: Scene[]) => {
    const cleanedScenes = scenes.filter(scene => scene.content !== '{"error":"couldn\'t find scene"}\n');
    return cleanedScenes.flatMap(scene => tokenise(scene));
}

export const tokenise = (scene: Scene) => {
    let proseBlock = '';
    
    let token = '';
    let insideToken = false;

    let parenthesisStack: string[] = [];
    let quoteStack: string[] = [];

    let insideMultilineToken = false;
    let tokenStartIndex = -1;
    
    const sceneLines = scene.content.replace('\r\n', '\n').split('\n');
    let lineNumber = 0;
    let cursor = 0;
    
    let previousIndent = 0;
    let indent = 0;
    let hasSeenText = false;
    const tokens: Token[] = [
        <SceneStart>{
            sceneName: scene.name,
            lineNumber: 0,
            position: 0,
            indent: 0,
            type: 'SceneStart'
        }
    ];
    
    while (lineNumber < sceneLines.length) {
        if(cursor >= sceneLines[lineNumber].length) {
            lineNumber++;
            cursor = 0;
            
            insideToken = false;

            tokenStartIndex = 0;
            
            token = '';
            
            previousIndent = indent;
            indent = 0;
            hasSeenText = false;
            
            if(proseBlock.length !== 0) {
                proseBlock += '\n';
            }
            continue;
        }
        
        const line = sceneLines[lineNumber];

        // --------------------------------------------------------
        // ----------------------- INDENT -------------------------
        // --------------------------------------------------------
        if(!hasSeenText) {
            if (line[cursor] !== '\t' && line[cursor] !== ' ') {
                hasSeenText = true;
            }
            if (line[cursor] === '\t') {
                indent++;
                cursor++;
                continue;
            }
            if (line[cursor] === ' ') {
                indent += 0.5;
                cursor++;
                continue;
            }
        }
        
        if(insideMultilineToken && indent < previousIndent) {
            insideMultilineToken = false;
        }
        
        if (line[cursor] === '#' || line[cursor] === '*') {
            insideToken = true;
            tokenStartIndex = cursor;
            if(proseBlock.length > 0) {
                tokens.push(<Prose>{
                    indent: indent,
                    type: 'Prose',
                    sceneName: scene.name,
                    content: proseBlock,
                    lineNumber: lineNumber,
                    position: cursor,
                });
                
                proseBlock = '';
            }
        }
        
        if (insideToken) {
            token += line[cursor];
            const evaluateToken = <TToken extends Token>(parser: TokenParser<TToken>) => {
                const {token: output, endIndex} = parser(scene, line, token, lineNumber, tokenStartIndex);

                output.sceneName = scene.name;
                output.indent = indent;
                output.lineNumber = lineNumber;

                tokens.push(output);
            }

            // evaluate token, decide if not inside token anymore
            switch (token) {
                case '*label': {
                    evaluateToken(labelParser);
                    token = '';
                    break;
                }
                case '*goto ': {
                    evaluateToken(gotoParser);
                    token = '';
                    break;
                }
                case '*goto_scene': {
                    evaluateToken(gotoSceneParser);
                    token = '';
                    break;
                }
                case '#': {
                    evaluateToken(optionParser);
                    token = '';
                    insideToken = false; // whole rest of line is now choice block logic
                    break;
                }
                case '*if': {
                    evaluateToken(ifParser);
                    token = '';
                    break;
                }
                case '*elseif':
                case '*elsif': {
                    evaluateToken(elseIfParser);
                    token = '';
                    break;
                }
                case '*else': {
                    evaluateToken(elseParser);
                    token = '';
                    break;
                }
                case '*create': {
                    evaluateToken(createCommandParser);
                    token = '';
                    break;
                }
                case '*temp': {
                    evaluateToken(createTempVariableParser);
                    token = '';
                    break;
                }
                case '*set': {
                    evaluateToken(setVariableParser);
                    token = '';
                    break;
                }
                case '*choice': {
                    evaluateToken(choiceParser);
                    token = '';
                    break;
                }
                case '*fake_choice': {
                    evaluateToken(fakeChoiceParser);
                    token = '';
                    break;
                }
                case '*finish': {
                    evaluateToken(finishParser);
                    token = '';
                    break;
                }
                case '*selectable_if': {
                    evaluateToken(selectableIfParser);
                    insideToken = false;
                    token = '';
                    break;
                }
                case '*comment': {
                    evaluateToken(commentParser);
                    token = '';
                    insideToken = false; // anything after comment is not parsed as command logic
                    break;
                }
                case '*scene_list': {
                    insideMultilineToken = true;
                    break;
                }
                case '*achievement': {
                    insideMultilineToken = true;
                    break;
                }
                case '"': {
                    // string literal start
                    if(quoteStack.filter(e => e === '"').length % 2 === 1) {
                        quoteStack.pop();
                        evaluateToken(stringLiteralParser)
                        break;
                    }
                    quoteStack.push('"');
                    break;
                }
                case "'": {
                    // string literal start
                    if(quoteStack.filter(e => e === "'").length % 2 === 1) {
                        quoteStack.pop();
                        evaluateToken(stringLiteralParser)
                        break;
                    }
                    quoteStack.push('"');
                    break;
                }
                case '(' : {
                    parenthesisStack.push('(');
                    break;
                }
                case ')' : {
                    parenthesisStack.pop(); //do expression stuff idK?
                    break;
                }
                case '+' : {
                    //check token for fairmath
                    break;
                }
                case '-' : {
                    // check token for fairmath
                    break;
                }
                case ' ': {
                    token = token.trim();
                    if(token.length > 0) {
                        if(isVariableName(token)) {
                            evaluateToken(variableReferenceParser);
                            token = '';
                        }
                    }
                }
            }
        }

        if (!insideToken && !insideMultilineToken) {
            if(cursor === 0 && !(line.includes('*') || line.includes('#'))) {
                //shortcut
                proseBlock += line;
                cursor = line.length;
                continue;
            }
            proseBlock += line[cursor];
        }
        cursor++;
    }
    tokens.push(
        <SceneEnd>{
            lineNumber: sceneLines.length,
            indent: 0,
            position: 0,
            sceneName: scene.name,
            type: 'SceneEnd'
        }
    );
    return tokens;
}
export const isVariableName = (value: string) => {
    for (let i = 0; i < value.length; i++) {
        const char = value.charAt(i);
        const isValid =
            (char >= 'a' && char <= 'z') ||
            (char >= 'A' && char <= 'Z') ||
            (char >= '0' && char <= '9') ||
            char === '_';

        if (!isValid) {
            return false;
        }
    }

    return true;
}
export const labelParser: TokenParser<Label> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    const label = line.slice(index);
    return {
        token: <Label>{
            type: 'Label',
            position: index,
            lineNumber: lineNumber,
            name: label.replace('*label', '').trim(),
        },
        endIndex: undefined
    };
}

export const gotoParser: TokenParser<GotoLabel> = (scene: Scene, line: string, token: string, lineNumber: number, startIndex: number) => {
    const target = line.replace('*goto ', '').trim();

    return {
        token: <GotoLabel>{
            type: 'GotoLabel',
            lineNumber: lineNumber,
            position: startIndex,
            target: target,
        },
        endIndex: undefined,
    };
}

export const gotoSceneParser: TokenParser<GotoScene> = (scene: Scene, line:string, token: string, lineNumber: number, index: number) => {
    const goto = line.slice(index);
    const target = goto.split('*goto_scene ')[1].trim();

    if (target.includes(' ')) {
        const parts = target.split(' ');
        return {
            token: <GotoScene>{
                type: 'GotoScene',
                position: index,
                lineNumber: lineNumber,
                target: parts[0].trim(),
                targetLabel: parts[1].trim(),
            },
            endIndex: undefined,
        };
    }

    return {
        token: <GotoScene>{
            type: 'GotoScene',
            position: index,
            lineNumber: lineNumber,
            target: target,
        },
        endIndex: undefined,
    };
}

export const finishParser: TokenParser<Finish> = (scene: Scene, line:string, token: string, lineNumber: number, index: number) => {
    return {
        token: <Finish>{
            type: 'Finish',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: undefined
    };
}

export const choiceParser: TokenParser<Choice> = (scene: Scene, line:string, token: string, lineNumber: number, index: number) => {
    return {
        token: <Choice>{
            type: 'Choice',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: undefined,
    };
}

export const optionParser: TokenParser<Option> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    const statement = line.slice(index);
    return {
        token: <Option>{
            type: 'Option',
            position: index,
            text: statement.replace('#', '').trim()
        },
        endIndex: undefined
    };
}

export const fakeChoiceParser: TokenParser<FakeChoice> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    return {
        token: <FakeChoice>{
            type: 'FakeChoice',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: undefined,
    };
}

export const selectableIfParser: TokenParser<SelectableIf> = (scene: Scene, line:string, token: string, lineNumber: number, index: number) => {
    const nextOption = line.indexOf('#', index);
    const nextStatement = line.indexOf('*', index);
    const indexToSlice = [nextOption, nextStatement].filter(a => a !== -1).sort()[0];
    const statement = line.slice(index, indexToSlice);
    return {
        token: <SelectableIf>{
            type: 'SelectableIf',
            position: index,
            lineNumber: lineNumber,
            expression: statement.replace('*selectable_if', '').trim()
        },
        endIndex: indexToSlice
    };
}

export const ifParser: TokenParser<If> = (scene: Scene, line: string, lineNumber: number, token: string, index: number) => {
    const nextOption = line.indexOf('#', index);
    const nextStatement = line.indexOf('*', index + 1); // +1 to avoid finding the current '*if'

    let indexToSlice = line.length;
    if (nextOption !== -1 || nextStatement !== -1) {
        // Find the closest next token
        const candidates = [nextOption, nextStatement].filter(a => a !== -1);
        if (candidates.length > 0) {
            indexToSlice = Math.min(...candidates);
        }
    }

    const statement = line.slice(index, indexToSlice);
    // Extract the expression between parentheses
    const expressionMatch = statement.match(/\*if\s*\(([^)]*)\)/);
    const expression = expressionMatch ? expressionMatch[1].trim() : statement.replace('*if', '').trim();

    return {
        token: <If>{
            type: 'If',
            position: index,
            lineNumber: lineNumber,
            expression: expression
        },
        endIndex: indexToSlice
    };
}

export const elseIfParser: TokenParser<ElseIf> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    const nextOption = line.indexOf('#', index);
    const nextStatement = line.indexOf('*', index + 1); // +1 to avoid finding the current '*elseif'

    let indexToSlice = line.length;
    if (nextOption !== -1 || nextStatement !== -1) {
        // Find the closest next token
        const candidates = [nextOption, nextStatement].filter(a => a !== -1);
        if (candidates.length > 0) {
            indexToSlice = Math.min(...candidates);
        }
    }

    const statement = line.slice(index, indexToSlice);
    // Extract the expression between parentheses
    const expressionMatch = statement.match(/\*(?:elseif|elsif)\s*\(([^)]*)\)/);
    const expression = expressionMatch ? expressionMatch[1].trim() : statement.replace(/\*(?:elseif|elsif)/, '').trim();

    return {
        token: <ElseIf>{
            type: 'ElseIf',
            position: index,
            lineNumber: lineNumber,
            expression: expression
        },
        endIndex: indexToSlice
    };
}

export const elseParser: TokenParser<Else> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    return {
        token: <Else>{
            type: 'Else',
            position: index,
            lineNumber: lineNumber
        },
        endIndex: undefined
    };
}

export const createTempVariableParser: TokenParser<CreateTempVariable> = (scene: Scene, line: string, token: string, lineNumber: number, index: number) => {
    // Extract the part after "*temp "
    const variableDeclaration = line.slice(index + 5).trim(); // +5 for "*temp "

    // Extract variable name and value
    const parts = variableDeclaration.split(/\s+/);
    const name = parts[0];

    // Join the rest as the value (if present)
    let value: string | number | boolean = parts.slice(1).join(' ').trim();

    // Convert to number if it's numeric
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        value = parseFloat(value);
    } else if (value === 'true' || value === 'false') {
        value = value === 'true';
    } else if (value === '') {
        // Default to 0 for empty values in ChoiceScript
        value = 0;
    }

    return {
        token: <CreateTempVariable>{
            type: 'CreateTempVariable',
            position: index,
            lineNumber: lineNumber,
            name: name,
            value: value
        },
        endIndex: undefined
    };
}
