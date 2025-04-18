export interface Scene {
    sourceUrl: string;
    name: string;
    content: string;

    prose: Prose[];
    labels: Label[];
    localJumps: GotoLabel[];
    externalJumps: GotoScene[];
    finishes: Finish[];
    createTempVariables: CreateTempVariable[];
    createVariables: CreateVariable[];
    setVariables: SetVariable[];

    choices: Choice[];
    options: Option[];
    fakeChoices: FakeChoice[];

    selectableIfs: SelectableIf[];
    ifs: If[];
    elses: Else[];
    elseIfs: ElseIf[];

    endings: Ending[];

    flow: Token[];
}

export interface Token {
    lineNumber: number;
    position: number;
    type: string;
    sceneName: string;
    indent: number;
}

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

export interface CreateVariable extends Token {
    name: string;
    value: string | number;
    type: 'CreateVariable';
}

export interface CreateTempVariable extends Token {
    name: string;
    value: string | number;
    type: 'CreateTempVariable';
}

export interface SetVariable extends Token {
    name: string;
    value: string | number;
    type: 'SetVariable';
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

export interface Ending extends Token {
    type: 'Ending';
}

export interface SceneStart extends Token {
    type: 'SceneStart';
}
export interface SceneEnd extends Token {
    type: 'SceneEnd';
}

type TokenParser<TToken> = (scene: Scene, line: string, lineNumber: number, startIndex: number) => { token: TToken, endIndex: number | undefined };

export const tokeniseScenes = async (scenes: Scene[]) => {
    const cleanedScenes = scenes.filter(scene => scene.content !== '{"error":"couldn\'t find scene"}\n');
    return cleanedScenes.flatMap(scene => tokenise(scene));
}

export const tokenise = (scene: Scene) => {
    let proseBlock = '';
    
    let token = '';
    let insideToken = false;
    let insideMultilineToken = false;
    let tokenStartIndex = -1;
    
    const sceneLines = scene.content.replace('\r\n', '\n').split('\n');
    let lineNumber = 0;
    let cursor = 0;
    
    let previousIndent = 0;
    let indent = 0;
    let seenText = false;
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
            seenText = false;
            
            if(proseBlock.length !== 0) {
                proseBlock += '\n';
            }
            continue;
        }
        
        const line = sceneLines[lineNumber];

        // --------------------------------------------------------
        // ----------------------- INDENT -------------------------
        // --------------------------------------------------------
        if(!seenText) {
            if (line[cursor] !== '\t' && line[cursor] !== ' ') {
                seenText = true;
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
                const {token, endIndex} = parser(scene, line, lineNumber, tokenStartIndex);
                token.sceneName = scene.name;
                token.indent = indent;
                token.lineNumber = lineNumber;
                tokens.push(token);
            }
            // evaluate token, decide if not inside token anymore
            switch (token) {
                case '*label': {
                    evaluateToken(labelParser);
                    break;
                }
                case '*goto ': {
                    evaluateToken(gotoParser);
                    break;
                }
                case '*goto_scene': {
                    evaluateToken(gotoSceneParser);
                    break;
                }
                case '#': {
                    evaluateToken(optionParser);
                    break;
                }
                case '*choice': {
                    evaluateToken(choiceParser);
                    break;
                }
                case '*fake_choice': {
                    evaluateToken(fakeChoiceParser);
                    break;
                }
                case '*finish': {
                    evaluateToken(finishParser);
                    break;
                }
                case '*selectable_if': {
                    evaluateToken(selectableIfParser);
                    insideToken = false;
                    token = '';
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
export const labelParser: TokenParser<Label> = (scene: Scene, line: string, lineNumber: number, index: number) => {
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

export const gotoParser: TokenParser<GotoLabel> = (scene: Scene, line: string, lineNumber: number, startIndex: number) => {
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

export const gotoSceneParser: TokenParser<GotoScene> = (scene: Scene, line:string, lineNumber: number, index: number) => {
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

export const finishParser: TokenParser<Finish> = (scene: Scene, line:string, lineNumber: number, index: number) => {
    return {
        token: <Finish>{
            type: 'Finish',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: undefined
    };
}

export const choiceParser: TokenParser<Choice> = (scene: Scene, line:string, lineNumber: number, index: number) => {
    return {
        token: <Choice>{
            type: 'Choice',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: undefined,
    };
}

export const optionParser: TokenParser<Option> = (scene: Scene, line: string, lineNumber: number, index: number) => {
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

export const fakeChoiceParser: TokenParser<FakeChoice> = (scene: Scene, line: string, lineNumber: number, index: number) => {
    return {
        token: <FakeChoice>{
            type: 'FakeChoice',
            position: index,
            lineNumber: lineNumber,
        },
        endIndex: undefined,
    };
}

export const selectableIfParser: TokenParser<SelectableIf> = (scene: Scene, line:string, lineNumber: number, index: number) => {
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