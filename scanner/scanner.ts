import { Scene } from "./scene";
import { ScannerContext } from "./scanner-context";
import {
    CommentToken,
    Token,
    SceneStartToken,
    SceneEndToken,
    GotoSceneToken,
    ChoiceToken,
    FakeChoiceToken,
    ChoiceOptionToken,
    GotoLabelToken,
    LabelToken,
    IfToken,
    ElseIfToken,
    ElseToken,
    CreateVariableToken,
    CreateTempVariableToken,
    SetVariableToken,
    SelectableIfToken,
    OpenMultiReplaceToken,
    ImageToken,
    InputTextToken,
    GameIdentifierToken,
    AuthorToken,
    PageBreakToken,
    SaveCheckpointToken,
    RestoreCheckpointToken,
    GoSubSceneToken,
    GoSubToken,
    ReturnToken,
    DeleteVariableToken,
    InputNumberToken,
    GenerateRandomToken,
    FinishToken,
    LinkToken,
    StatChartToken,
    GotoRandomSceneToken,
    EndingToken,
    HideReuseToken,
    DisableReuseToken,
    AllowReuseToken,
    LineBreakToken,
    ProseToken
} from "./tokens";
import {tokenizeExpressionString} from './expression-handler';

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
        <SceneStartToken>{
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

            if(context.proseBlock.trim().length !== 0) {
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
                    if(context.proseBlockStart === undefined) {
                        context.proseBlockStart = {
                            position: context.position,
                            lineNumber: context.lineNumber,
                            indent: context.indent.current,
                        };
                    }
                    context.proseBlock += line;
                    context.position = line.length;
                    continue;
                }

                if (isStartOfToken(line[context.position])) {
                    context.mode = "Token";
                    context.currentTokenStartPosition = context.position;
                    if(context.proseBlock.trim().length > 0) {
                        tokens.push(<ProseToken>{
                            indent: context.proseBlockStart.indent,
                            type: 'Prose',
                            sceneName: scene.name,
                            content: context.proseBlock,
                            lineNumber: context.proseBlockStart.lineNumber,
                            position: context.proseBlockStart.position,
                        });

                        context.proseBlock = '';
                        context.proseBlockStart = undefined;
                    }

                    continue;
                }

                if(context.proseBlockStart === undefined) {
                    context.proseBlockStart = { 
                        position: context.position,
                        lineNumber: context.lineNumber,
                        indent: context.indent.current,
                    }
                }
                context.proseBlock += line[context.position];
                context.position++;
                break;
            }
            case "ProseToEOL" : {
                if(context.position < line.length) {
                    if(context.proseBlock.length > 0) {
                        console.error("Unexpected ProseToEOL mode with existing prose block");
                    }
                    context.proseBlock = '';
                    const substring = line.substring(context.position);
                    tokens.push(<ProseToken>{
                        indent: context.indent.current,
                        type: 'Prose',
                        sceneName: scene.name,
                        content: substring,
                        lineNumber: context.lineNumber,
                        position: context.position,
                    });
                    context.position = line.length;
                }
                context.mode = 'Prose';
                break;
            }
            case "Expression":
                {
                    if (isStartOfToken(line[context.position])) {
                        var expressionTokens = tokenizeExpressionString(
                            context.currentToken,
                            context.lineNumber,
                            context.currentTokenStartPosition,
                            context.indent.current,
                            context.currentScene.name);
                        tokens.push(...expressionTokens);
                        context.mode = "Token";
                        context.currentTokenStartPosition = context.position;
                        context.currentToken = '';
                        //console.log('Encountered Token, switching mode to Token after expression', expressionTokens)
                        continue;
                    }

                    if(context.currentTokenStartPosition == undefined)
                        context.currentTokenStartPosition = context.position;
                    
                    context.currentToken += line[context.position];

                    if(context.position == line.length - 1) {
                        // eol, we parse the expression
                        var expressionTokens = tokenizeExpressionString(
                            context.currentToken,
                            context.lineNumber,
                            context.currentTokenStartPosition,
                            context.indent.current,
                            context.currentScene.name);
                        
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

                const comment = <CommentToken>tokens[tokens.length -1];
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
                const choiceOption = <ChoiceOptionToken>tokens[tokens.length -1];
                if(choiceOption.type !== 'ChoiceOption')
                {
                    console.error("Unexpected choice option mode entry, head is not a choice option block");
                }
                choiceOption.rawText = line.substring(context.position);
                
                const multiReplaceBegin = choiceOption.rawText.indexOf('@{');
                choiceOption.hasMultiReplace = multiReplaceBegin !== -1;
                context.currentToken = '';
                context.currentTokenStartPosition = undefined;
                context.position = line.length;
                
                break;
            }
        }
    }
    tokens.push(
        <SceneEndToken>{
            lineNumber: sceneLines.length,
            indent: 0,
            position: 0,
            sceneName: scene.name,
            type: 'SceneEnd'
        }
    );
    return tokens;
}

const parseMultireplaceFromProse = (proseString: string, context: ScannerContext): Token[] => {
    const multi = proseString.split('@{');
    const tokens = [];
    for(let i = 0; i < multi.length; i++) {
        if(i === 0) {
            tokens.push(<ProseToken>{
                content: multi[i],
                type: 'Prose',
                indent: context.indent.current,
                lineNumber: context.indent.current,
                position: context.position + proseString.indexOf(multi[i]),
            });
        }

        if(multi.length === 1) {
            continue;
        }

        const m = multi[i];
        const multiReplaceExpression = m.split('}');

        if(multiReplaceExpression.length > 1) {
            tokens.push(<ProseToken>{
                content: multiReplaceExpression[1],
                type: 'Prose',
                indent: context.indent.current,
                lineNumber: context.indent.current,
                position: context.position + proseString.indexOf(multiReplaceExpression[1]),
            });
        }

        if(multiReplaceExpression.length === 1) continue;
        
        const expression = tokenizeExpressionString(
            multiReplaceExpression[0],
            context.lineNumber,
            context.position,
            context.indent.current,
            context.currentScene.name);
        
        tokens.push(...expression);
    }

    return tokens;
}

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
            return createInContextToken(<LabelToken>{type: 'Label'});
        }
        case '*hide_reuse': {
            context.mode = "Prose";
            return createInContextToken(<HideReuseToken>{type: 'HideReuse'});
        }
        case '*disable_reuse': {
            context.mode = "Prose";
            return createInContextToken(<DisableReuseToken>{type: 'DisableReuse'});
        }
        case '*allow_reuse': {
            context.mode = "Prose";
            return createInContextToken(<AllowReuseToken>{type: 'AllowReuse'});
        }
        case '*gosub ': {
            context.mode = "Expression";
            return createInContextToken(<GoSubToken>{type: 'GoSub'});
        }
        case '*gosub_scene ': {
            context.mode = "Expression";
            return createInContextToken(<GoSubSceneToken>{type: 'GoSubScene'});
        }
        case '*return ': {
            context.mode = "Expression";
            return createInContextToken(<ReturnToken>{type: 'Return'});
        }
        case '*goto ': {
            context.mode = "Expression";
            return createInContextToken(<GotoLabelToken>{type: 'GotoLabel'});
        }
        case '*goto_scene': {
            context.mode = "Expression";
            return createInContextToken(<GotoSceneToken>{type: 'GotoScene'});
        }
        case '*goto_random_scene': {
            context.mode = "Expression";
            return createInContextToken(<GotoRandomSceneToken>{type: 'GotoRandomScene'});
        }
        case '#': {
            context.mode = "ChoiceOption";
            return createInContextToken(<ChoiceOptionToken>{type: 'ChoiceOption'});
        }
        case '*if': {
            context.mode = "Expression";
            return createInContextToken(<IfToken>{type: 'If'});
        }
        case '*else if':
        case '*elseif':
        case '*elsif': {
            context.mode = "Expression";
            return createInContextToken(<ElseIfToken>{type: 'ElseIf'});
        }
        case '*else\n':
        case '*else ': {
            context.mode = "Expression";
            return createInContextToken(<ElseToken>{type: 'Else'});
        }
        case '*create': {
            context.mode = "Expression";
            return createInContextToken(<CreateVariableToken>{type: 'CreateVariable'});
        }
        case '*temp': {
            context.mode = "Expression";
            return createInContextToken(<CreateTempVariableToken>{type: 'CreateTempVariable'});
        }
        case '*set': {
            context.mode = "Expression";
            return createInContextToken(<SetVariableToken>{type: 'SetVariable'});
        }
        case '*choice': {
            context.mode = "Prose";
            return createInContextToken(<ChoiceToken>{type: 'Choice'});
        }
        case '*fake_choice': {
            context.mode = "Prose";
            return createInContextToken(<FakeChoiceToken>{type: 'FakeChoice'});
        }
        case '*finish': {
            context.mode = "ProseToEOL";
            return createInContextToken(<FinishToken>{type: 'Finish'});
        }
        case '*ending': {
            context.mode = "ProseToEOL";
            return createInContextToken(<EndingToken>{type: 'Ending'});
        }
        case "*stat_chart": {
            context.mode = "Prose"
            return createInContextToken(<StatChartToken>{type: 'StatChart'});
        }
        case "*line_break": {
            context.mode = "Prose"
            return createInContextToken(<LineBreakToken>{type: 'LineBreak'});
        }
        case '*selectable_if': {
            context.mode = "Expression";
            return createInContextToken(<SelectableIfToken>{ type: 'SelectableIf' });
        }
        case '*link': {
            context.mode = "Expression";
            return createInContextToken(<LinkToken>{ type: 'Link' });
        }
        case '*comment': {
            context.mode = "Comment";
            return createInContextToken(<CommentToken>{ type: 'Comment' });
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
            return createInContextToken(<ImageToken>{type: 'Image'});
        }
        case "*input_number": {
            context.mode = "Expression";
            return createInContextToken(<InputNumberToken>{type: 'InputNumber'});
        }
        case "*input_text": {
            context.mode = "Expression";
            return createInContextToken(<InputTextToken>{type: 'InputText'});
        }
        case "*author": {
            context.mode = "Expression";
            return createInContextToken(<AuthorToken>{type: 'Author'});
        }
        case "*ifid": {
            context.mode = "Expression";
            return createInContextToken(<GameIdentifierToken>{type: 'GameIdentifier'});
        }
        case "*page_break": {
            context.mode = "ProseToEOL";
            return createInContextToken(<PageBreakToken>{type: 'PageBreak'});
        }
        case "*save_checkpoint": {
            context.mode = "Prose";
            return createInContextToken(<SaveCheckpointToken>{type: 'SaveCheckpoint'});
        }
        case "*restore_checkpoint": {
            context.mode = "Prose";
            return createInContextToken(<RestoreCheckpointToken>{type: 'RestoreCheckpoint'});
        }
        case "*delete": {
            context.mode = "Expression";
            return createInContextToken(<DeleteVariableToken>{type: 'DeleteVariable'});
        }
        case "*rand": {
            context.mode = "Expression";
            return createInContextToken(<GenerateRandomToken>{type: 'GenerateRandom'});
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