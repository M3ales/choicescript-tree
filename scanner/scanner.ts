import { Scene } from "./scene";
import { ScannerContext } from "./scanner-context";
import {
    Comment,
    Token,
    SceneStart,
    SceneEnd,
    GotoScene,
    Choice,
    FakeChoice,
    ChoiceOption,
    GotoLabel,
    Label,
    If,
    ElseIf,
    Else,
    CreateVariable,
    CreateTempVariable,
    SetVariable,
    SelectableIf,
    BeginMultiReplace,
    Image,
    InputText,
    GameIdentifier,
    Author,
    PageBreak,
    SaveCheckpoint,
    RestoreCheckpoint,
    GoSubScene,
    GoSub,
    Return
} from "./tokens";
import {tokenizeExpressionString} from './expression-handler';
import { Prose } from "../tokens/prose";

export const scanScene = (scene: Scene) => {
    const context: ScannerContext = {
        proseBlock: '',
        currentScene: scene,
        lineNumber: 0,
        position: 0,
        mode: 'Indentation',
        currentToken: '',
        currentTokenStartPosition: undefined,

        insideMultiLineToken: false,
        indent: {
            current: 0,
            previous: undefined,
        },
    };

    const tokens: Token[] = [
        <SceneStart>{
            sceneName: scene.name,
            lineNumber: 0,
            position: 0,
            indent: 0,
            type: 'SceneStart'
        }
    ];

    const sceneLines = scene.content.replace('\r\n', '\n').split('\n');

    let lastMode = 'Initial';
    while (context.lineNumber < sceneLines.length) {

        if(lastMode !== context.mode) {
            //console.log(`Transition from ${lastMode} to ${context.mode}`)
            lastMode = context.mode;
        }

        // Line end reached case
        if(context.position >= sceneLines[context.lineNumber].length) {
            context.lineNumber++;
            context.position = 0;

            context.currentTokenStartPosition = undefined;
            context.mode = 'Indentation';
            context.currentTokenStartPosition = 0;
            context.currentToken = '';
            context.indent.previous = context.indent.current;
            context.indent.current = 0;

            if(context.proseBlock.length !== 0) {
                context.proseBlock += '\n';
            }
            continue;
        }

        const line = sceneLines[context.lineNumber];

        switch(context.mode) {
            case "Indentation": {
                const indentation  = context.indent;
                if (line[context.position] === '\t') {
                    indentation.current++;
                    context.position++;
                    continue;
                }
                if (line[context.position] === ' ') {
                    indentation.current += 0.5;
                    context.position++;
                    continue;
                }

                if(context.insideMultiLineToken
                    && context.indent.current < context.indent.previous) {
                    context.insideMultiLineToken = false;
                }
                context.mode = "Prose";
                break;
            }
            case "Prose": {
                if(context.position === 0 && !(line.includes('*') || line.includes('#'))) {
                    //shortcut to speed up evaluation of large prose blocks (majority of the text)
                    context.proseBlock += line;
                    context.position = line.length;
                    continue;
                }

                if (isStartOfToken(line[context.position])) {
                    context.mode = "Token";
                    context.currentTokenStartPosition = context.position;
                    if(context.proseBlock.length > 0) {
                        tokens.push(<Prose>{
                            indent: context.indent.current,
                            type: 'Prose',
                            sceneName: scene.name,
                            content: context.proseBlock,
                            lineNumber: context.lineNumber,
                            position: context.position,
                        });

                        context.proseBlock = '';
                    }

                    continue;
                }
                context.proseBlock += line[context.position];
                context.position++;
                break;
            }
            case "Expression":
                {
                    if (isStartOfToken(line[context.position])) {
                        context.mode = "Token";
                        context.currentTokenStartPosition = context.position;
                        var expressionTokens = handleExpression(context);
                        tokens.push(...expressionTokens);
                        //console.log('Encountered Token, switching mode to Token after expression', expressionTokens)
                        continue;
                    }

                    if(context.currentTokenStartPosition == undefined)
                        context.currentTokenStartPosition = context.position;

                    context.currentToken += line[context.position];

                    if(context.position == line.length - 1) {
                        // eol, we parse the expression
                        var expressionTokens = handleExpression(context);
                        //console.log("EOL reached, scanning expression", expressionTokens)
                        tokens.push(...expressionTokens);
                    }

                    context.position++;
                    break;
                }
            case "Token": {
                context.currentToken += line[context.position];
                const token = handleToken(context);
                if(token != undefined) {
                    //console.log('Matched token', token);
                    tokens.push(token);
                }
                context.position++;
                break;
            }
            case "Comment": {
                context.position++;

                const comment = <Comment>tokens[tokens.length -1];
                if(comment.type !== 'Comment')
                {
                    console.error("Unexpected comment mode entry, head is not a comment block");
                }

                comment.value = line.substring(context.position);
                context.currentToken = '';
                context.currentTokenStartPosition = undefined;
                context.position = line.length;
                break;
            }
            case "ChoiceOption": {
                const choiceOption = <ChoiceOption>tokens[tokens.length -1];
                if(choiceOption.type !== 'ChoiceOption')
                {
                    console.error("Unexpected choice option mode entry, head is not a choice option block");
                }

                choiceOption.rawText = line.substring(context.position);
                
                if(choiceOption.rawText.indexOf('@{') !== -1) {
                    // multi-replace detected, this should probably be a while instead since multiple per line
                    choiceOption.expression = tokenizeExpressionString(
                        line.substring(context.position),
                        context.lineNumber,
                        context.position,
                        context.indent.current,
                        scene.name);
                    
                    tokens.push(...choiceOption.expression);
                }

                context.currentToken = '';
                context.currentTokenStartPosition = undefined;
                context.position = line.length;
                break;
            }
        }
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

const handleExpression = (context: ScannerContext) => {
    return tokenizeExpressionString(
        context.currentToken,
        context.lineNumber,
        context.currentTokenStartPosition,
        context.indent.current,
        context.currentScene.name);
};

const handleToken = (context: ScannerContext) => {
      const createInContextToken = (token: Token) => {
        token.sceneName = context.currentScene.name;
        token.indent = context.indent.current;
        token.lineNumber = context.lineNumber;
        token.position = context.currentTokenStartPosition;
        context.currentTokenStartPosition = undefined;
        context.currentToken = '';
        return token;
    };

    // evaluate token, decide if not inside token anymore
    switch(context.currentToken) {
        case '*label': {
            context.mode = "Expression";
            return createInContextToken(<Label>{type: 'Label'});
        }
        case '*gosub ': {
            context.mode = "Expression";
            return createInContextToken(<GoSub>{type: 'GoSub'});
        }
        case '*gosub_scene ': {
            context.mode = "Expression";
            return createInContextToken(<GoSubScene>{type: 'GoSubScene'});
        }
        case '*return ': {
            context.mode = "Expression";
            return createInContextToken(<Return>{type: 'Return'});
        }
        case '*goto ': {
            context.mode = "Expression";
            return createInContextToken(<GotoLabel>{type: 'GotoLabel'});
        }
        case '*goto_scene': {
            context.mode = "Expression";
            return createInContextToken(<GotoScene>{type: 'GotoScene'});
        }
        case '#': {
            context.mode = "ChoiceOption";
            return createInContextToken(<ChoiceOption>{type: 'ChoiceOption'});
        }
        case '*if': {
            context.mode = "Expression";
            return createInContextToken(<If>{type: 'If'});
        }
        case '*elseif':
        case '*elsif': {
            context.mode = "Expression";
            return createInContextToken(<ElseIf>{type: 'ElseIf'});
        }
        case '*else': {
            context.mode = "Expression";
            return createInContextToken(<Else>{type: 'Else'});
        }
        case '*create': {
            context.mode = "Expression";
            return createInContextToken(<CreateVariable>{type: 'CreateVariable'});
        }
        case '*temp': {
            context.mode = "Expression";
            return createInContextToken(<CreateTempVariable>{type: 'CreateTempVariable'});
        }
        case '*set': {
            context.mode = "Expression";
            return createInContextToken(<SetVariable>{type: 'SetVariable'});
        }
        case '*choice': {
            context.mode = "Prose";
            return createInContextToken(<Choice>{type: 'Choice'});
        }
        case '*fake_choice': {
            context.mode = "Prose";
            return createInContextToken(<FakeChoice>{type: 'FakeChoice'});
        }
        case '*finish': {
            context.mode = "Prose";
            return createInContextToken(<SetVariable>{type: 'SetVariable'});
        }
        case '*selectable_if': {
            context.mode = "Expression";
            return createInContextToken(<SelectableIf>{ type: 'SelectableIf' });
        }
        case '*comment': {
            context.mode = "Comment";
            return createInContextToken(<Comment>{ type: 'Comment' });
        }
        case '*scene_list': {
            context.insideMultiLineToken = true;
            break;
        }
        case '*achievement': {
            context.insideMultiLineToken = true;
            break;
        }
        case "*image": {
            context.mode = "Expression";
            return createInContextToken(<Image>{type: 'Image'});
        }
        case "*input_text": {
            context.mode = "Expression";
            return createInContextToken(<InputText>{type: 'InputText'});
        }
        case "*author": {
            context.mode = "Expression";
            return createInContextToken(<Author>{type: 'Author'});
        }
        case "*ifid": {
            context.mode = "Expression";
            return createInContextToken(<GameIdentifier>{type: 'GameIdentifier'});
        }
        case "*page_break": {
            context.mode = "Prose";
            return createInContextToken(<PageBreak>{type: 'PageBreak'});
        }
        case "*save_checkpoint": {
            context.mode = "Prose";
            return createInContextToken(<SaveCheckpoint>{type: 'SaveCheckpoint'});
        }
        case "*restore_checkpoint": {
            context.mode = "Prose";
            return createInContextToken(<RestoreCheckpoint>{type: 'RestoreCheckpoint'});
        }
    }

    return undefined;
}

const isStartOfToken = (char: string) : boolean => {
    return char == "*" || char == "#";
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