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
    ProseToken,
    SceneListToken,
    AchieveToken,
    AchievementToken,
    CheckAchievementsToken,
    StringLiteralToken,
    IdentifierToken,
    NumberLiteralToken
} from "./tokens";
import {tokenizeExpressionString} from './expression-handler';
import { parseAchievementBlock as scanAchievementBlock } from "./achievement-handler";
import { handleSceneList } from "./scene-list-handler";
import { countIndentation, scanIndentCharacter } from "./indent";

export const scanScene = (scene: Scene) => {
    const context: ScannerContext = {
        proseBlock: '',
        proseBlockStart: undefined,
        scene: scene,
        lineNumber: 0,
        position: 0,
        mode: 'Prose',
        currentToken: '',
        currentTokenStartPosition: undefined,
        insideMultiLineToken: false,
        indent: {
            current: 0,
            previous: undefined,
        },
        currentLine: "",
        sceneLines: []
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

    context.sceneLines = scene.content.replace('\r\n', '\n').split('\n');

    let lastMode = 'Initial';
    while (context.lineNumber < context.sceneLines.length) {

        if(lastMode !== context.mode) {
            //console.log(`Transition from ${lastMode} to ${context.mode}`)
            lastMode = context.mode;
        }

        // Line end reached case
        if(context.position >= context.sceneLines[context.lineNumber].length) {
            context.lineNumber++;
            context.position = 0;

            context.currentTokenStartPosition = undefined;
            context.mode = 'Prose';
            context.currentTokenStartPosition = 0;
            context.currentToken = '';
            context.indent.previous = context.indent.current;
            context.indent.current = 0;

            if(context.proseBlock.trim().length !== 0) {
                context.proseBlock += '\n';
            }
            continue;
        }

        const line = context.sceneLines[context.lineNumber];
        context.currentLine = line;

        if(line.trim().length === 0) {
            context.position = line.length;
            context.indent.current = context.indent.previous;
            continue;
        }

        const lineIndent = countIndentation(line);
        
        context.indent.current = lineIndent.indent;
        context.position = lineIndent.position;

        if(context.insideMultiLineToken && context.indent.previous > context.indent.current) {
            context.insideMultiLineToken = false;
        }

        while(context.position < line.length) {
            switch(context.mode) {
                case "Prose": {
                    if(context.position === (context.indent.current * 2) && !(line.includes('*') || line.includes('#'))) {
                        //shortcut to speed up evaluation of large prose blocks (majority of the text)
                        if(context.proseBlockStart === undefined) {
                            context.proseBlockStart = {
                                position: context.position,
                                lineNumber: context.lineNumber,
                                indent: context.indent.current,
                            };
                        }
                        context.proseBlock += line.trimStart();
                        context.position = line.length;
                        continue;
                    }

                    let arraySelectorInsideMultireplace = false;
                    if(line.includes('{') && line.includes('#')) { // TODO: actually parse this so we dont deal with this hellish thing, bad fix
                        // might be mutli replace
                        arraySelectorInsideMultireplace = isInsideMultiReplaceOrVariable(line);
                    }

                    if (!arraySelectorInsideMultireplace && isStartOfToken(line[context.position])) {
                        context.mode = "Token";
                        context.currentTokenStartPosition = context.position;
                        if(context.proseBlock.trim().length > 0) {
                            tokens.push(<ProseToken>{
                                indent: context.proseBlockStart.indent,
                                type: 'Prose',
                                sceneName: scene.name,
                                content: context.proseBlock.trimStart(),
                                lineNumber: context.proseBlockStart.lineNumber,
                                position: context.proseBlockStart.position,
                            });
                        }

                        context.proseBlock = '';
                        context.proseBlockStart = undefined;
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
                            content: substring.trimStart(),
                            lineNumber: context.lineNumber,
                            position: context.position,
                        });
                        context.position = line.length;
                    }
                    context.mode = 'Prose';
                    break;
                }
                case "Expression": {
                        if (isStartOfToken(line[context.position])) {
                            var expressionTokens = tokenizeExpressionString(
                                context.currentToken,
                                context.lineNumber,
                                context.currentTokenStartPosition,
                                context.indent.current,
                                context.scene.name);
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
                                context.scene.name);
                            
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

                    comment.value = line.substring(context.position).trimEnd();
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
                case "Achievement": {
                    const preLine = context.sceneLines[context.lineNumber + 1];
                    const postLine = context.sceneLines[context.lineNumber + 2];
                    //console.log('Reading Achievement', line, preLine, postLine);
                    const scanned = scanAchievementBlock(
                        line,
                        context.position,
                        preLine,
                        postLine,
                        context.lineNumber,
                        context.indent.current,
                        context.scene.name
                    );

                    tokens.push(...scanned);
                    context.position = postLine.length;
                    context.lineNumber += 2;
                    context.insideMultiLineToken = false;

                    context.mode = "Prose";
                    break;
                }
            }
        }
        // Handle multi line blocks
        switch(context.mode) {
            case "SceneList": {
                tokens.push(...handleSceneList(context));
                break;
            }
        }
    }
    tokens.push(
        <SceneEndToken>{
            lineNumber: context.sceneLines.length,
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
            context.scene.name);
        
        tokens.push(...expression);
    }

    return tokens;
}

const handleToken = (context: ScannerContext) => {
      const createInContextToken = (token: Token) => {
        token.sceneName = context.scene.name;
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
        case '*else': {
            if(context.position + 1 >= context.currentLine.trimEnd().length) {
                context.mode = "Expression";
                return createInContextToken(<ElseToken>{type: 'Else'});
            }
            break;
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
            context.mode = "ProseToEOL";
            return createInContextToken(<LinkToken>{ type: 'Link' });
        }
        case '*comment': {
            context.mode = "Comment";
            return createInContextToken(<CommentToken>{ type: 'Comment' });
        }
        case '*scene_list': {
            context.mode = "SceneList";
            return createInContextToken(<SceneListToken>{ type: 'SceneList' });
        }
        case '*achievement': {
            context.mode = "Achievement";
            return createInContextToken(<AchievementToken>{type: 'Achievement'});
        }
        case '*check_achievements': {
            context.mode = "Prose";
            return createInContextToken(<CheckAchievementsToken>{type: 'CheckAchievements'});
        }
        case '*achieve ': {
            context.mode = "Expression";
            return createInContextToken(<AchieveToken>{type: 'Achieve'});
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
            context.mode = "ProseToEOL";
            return createInContextToken(<AuthorToken>{type: 'Author'});
        }
        case "*ifid": {
            context.mode = "ProseToEOL";
            return createInContextToken(<GameIdentifierToken>{type: 'GameIdentifier'});
        }
        case "*purchase_discount": {
            context.mode = "Prose";
            break;
        }
        case "*page_break_advertisement":
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

const isInsideMultiReplaceOrVariable = (line: string) => {
    const pos = line.indexOf('#');
    if(pos == 0)
        return false;
    const left = line.slice(0, pos-1);
    const right = line.slice(pos+1);
    if(left.includes('#')){
        return isInsideMultiReplaceOrVariable(left) &&
        left.includes('{') && right.includes('}');
    }
    if(right.includes('#')){
        return isInsideMultiReplaceOrVariable(right) && 
        left.includes('{') && right.includes('}');
    }

    return left.includes('{') && right.includes('}');
}

const parseAchievement = (
    line: string,
    lineNumber: number,
    sceneName: string,
    beforeDescription: string,
    afterDescription: string) => {
    const parts = line.split(' ');
    if(parts.length < 2) {
        return null;
    }
}

const isLikelyExpression = (line: string) => {
    const expression = tokenizeExpressionString(line, 0, 0, 0, 'none');
    const literals: StringLiteralToken[] = expression.filter(e => e.type === 'StringLiteral').map(e => e as StringLiteralToken);

    if(line.includes("'") && !literals.some(l => l.value.includes("'"))) {
        return false;
    }
    if(line.includes(".") && !literals.some(l => l.value.includes("."))) {
        return false;
    }
    if(line.includes(",") && !literals.some(l => l.value.includes(","))) {
        return false;
    }

    if(expression.length > 1 && 
        expression.every(e => e.type == 'Identifier')) {
        return false;
    }

    return true;
}