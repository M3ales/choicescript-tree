import {loadScene} from "./index";

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
    fakeChoices:FakeChoice[];

    selectableIfs: SelectableIf[];
    ifs: If[];
    elses: Else[];
    elseIfs: ElseIf[];

    endings: Ending[];

    flow: Token[];
}

export interface Token {
    index: number;
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

type TokenParser<TToken> = (scene: Scene, index: number) => TToken;

export const parseScenesToTokensInPlace = async (scenes: Scene[])=>{

    for (const scene of scenes) {
        scene.labels = readToken(scene, '*label', labelParser);
        scene.localJumps = readToken(scene, '*goto', gotoParser);
        scene.externalJumps = readToken(scene, '*goto_scene', gotoSceneParser);
        scene.finishes = readToken(scene, '*finish', finishParser, false);
        scene.createTempVariables = readToken(scene, '*temp', createTempVariableParser);
        scene.createVariables = readToken(scene, '*create', createVariableParser);
        scene.setVariables = readToken(scene, '*set', setVariableParser);

        scene.choices = readToken(scene, '*choice', choiceParser, false);
        scene.options = readToken(scene, '#', optionParser, false);
        scene.fakeChoices = readToken(scene, '*fake_choice', fakeChoiceParser, false);

        scene.selectableIfs = readToken(scene, '*selectable_if', selectableIfParser, false);
        scene.ifs = readToken(scene, '*if', ifParser, false);
        scene.elseIfs = readToken(scene, '*elseif', elseIfParser, false);
        scene.elses = readToken(scene, '*else', elseParser, false);

        scene.endings = readToken(scene, '*ending', endingParser, false);\
        
        scene.prose = readProse(scene);

        //O(19n)
        // atleast O(n^2) if less than 19 structural lines

        // TODO: add gosub/gosub_scene
        scene.flow = [
            <SceneStart>{ type: 'SceneStart', index: 0, indent: 0, sceneName: scene.name },
            ...scene.choices,
            ...scene.fakeChoices,
            ...scene.options,
            ...scene.labels,
            ...scene.localJumps,
            ...scene.externalJumps,
            ...scene.finishes,
            ...scene.createTempVariables,
            ...scene.createVariables,
            ...scene.setVariables,
            ...scene.selectableIfs,
            ...scene.ifs,
            ...scene.elseIfs,
            ...scene.elses,
            ...scene.endings,
        ].sort((a: Token,b: Token) => a.index - b.index);

        // scene links are:
        // - goto_scene
        // - gosub_scene
        // - finish
    }
    
    const gotoScenes = scenes
        .flatMap(scene => scene.externalJumps)
        .filter(goto => !(scenes.some(scene => scene.name === goto.target)))
        .map(goto => goto.target);
    
    const scenesNotInStartup = await Promise.all(
        gotoScenes
        .filter(((target, index) => gotoScenes.indexOf(target) === index))
        .map(target => loadScene(target.trim()))
    );

    console.info(`Found ${scenesNotInStartup.length} scenes that were not in the scene list, adding...`);
    for (const scene of scenesNotInStartup) {
        scene.labels = readToken(scene, '*label', labelParser);
        scene.localJumps = readToken(scene, '*goto', gotoParser);
        scene.externalJumps = readToken(scene, '*goto_scene', gotoSceneParser);
        scene.finishes = readToken(scene, '*finish', finishParser, false);
        scene.createTempVariables = readToken(scene, '*temp', createTempVariableParser);
        scene.createVariables = readToken(scene, '*create', createVariableParser);
        scene.setVariables = readToken(scene, '*set', setVariableParser);

        scene.choices = readToken(scene, '*choice', choiceParser, false);
        scene.options = readToken(scene, '#', optionParser, false);
        scene.fakeChoices = readToken(scene, '*fake_choice', fakeChoiceParser, false);

        scene.selectableIfs = readToken(scene, '*selectable_if', selectableIfParser, false);
        scene.ifs = readToken(scene, '*if', ifParser, false);
        scene.elseIfs = readToken(scene, '*elseif', elseIfParser, false);
        scene.elses = readToken(scene, '*else', elseParser, false);

        scene.endings = readToken(scene, '*ending', endingParser, false);

        //O(19n)
        // atleast O(n^2) if less than 19 structural lines

        // TODO: add gosub/gosub_scene
        scene.flow = [
            <SceneStart>{ type: 'SceneStart', index: 0, indent: 0, sceneName: scene.name },
            ...scene.choices,
            ...scene.fakeChoices,
            ...scene.options,
            ...scene.labels,
            ...scene.localJumps,
            ...scene.externalJumps,
            ...scene.finishes,
            ...scene.createTempVariables,
            ...scene.createVariables,
            ...scene.setVariables,
            ...scene.selectableIfs,
            ...scene.ifs,
            ...scene.elseIfs,
            ...scene.elses,
            ...scene.endings,
        ].sort((a: Token,b: Token) => a.index - b.index);

        // scene links are:
        // - goto_scene
        // - gosub_scene
        // - finish
    }
    
    return [...scenes, ...scenesNotInStartup].filter(scene => scene.content !== '{"error":"couldn\'t find scene"}\n');
}

export const readToken = <TToken extends Token>(scene: Scene, keyword: string, parser: TokenParser<TToken>, appendWhitespace = true) => {
    const occurrences: TToken[] = [];
    let index = 0;
    index = scene.content.indexOf(keyword + (appendWhitespace ? ' ' : ''));
    while(index !== -1) {
        const token = parser(scene, index);
        token.indent = calculateIndent(scene.content, index);
        token.sceneName = scene.name;
        occurrences.push(token);
        index = scene.content.indexOf(keyword + (appendWhitespace ? ' ' : ''), index + 1);
    }
    return occurrences;
}

export const labelParser: TokenParser<Label> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const label = scene.content.slice(index, nextNewline);
    return <Label>{
        type: 'Label',
        index: index,
        name: label.replace('*label', '').trim(),
    };
}

export const gotoParser: TokenParser<GotoLabel> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const goto = scene.content.slice(index, nextNewline);
    const target = goto.replace('*goto ', '').trim();
    const matchingLabel = scene.labels.find(label => label.name === target);

    if(matchingLabel === undefined) {
        //throw new Error(`Failed to find matching label '${target}' for *goto at ${index} in ${scene.name}`);
        console.warn(`Failed to find matching label '${target}' for *goto at ${index} in ${scene.name}`)
    }

    return <GotoLabel>{
        type: 'GotoLabel',
        index: index,
        target: target,
    };
}

export const gotoSceneParser: TokenParser<GotoScene> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const goto = scene.content.slice(index, nextNewline);
    const target = goto.split('*goto_scene ')[1].trim();

    if(target.includes(' ')) {
        const parts = target.split(' ');
        return <GotoScene>{
            type: 'GotoScene',
            index: index,
            target: parts[0].trim(),
            targetLabel: parts[1].trim(),
        };
    }

    return <GotoScene>{
        type: 'GotoScene',
        index: index,
        target: target,
    };
}

export const finishParser: TokenParser<Finish> = (scene: Scene, index: number) => {
    return <Finish>{
        type: 'Finish',
        index: index,
    };
}

export const createVariableParser: TokenParser<CreateVariable> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const statement = scene.content.slice(index, nextNewline);
    const parts = statement.split(' ');
    if(parts.length > 2) {
        return <CreateVariable>{
            type: 'CreateVariable',
            index: index,
            name: parts[1].trim(),
            value: parts[2].trim(),
        };
    }
    return <CreateVariable>{
        type: 'CreateVariable',
        index: index,
        name: parts[1].trim(),
    };
}


export const setVariableParser: TokenParser<SetVariable> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const statement = scene.content.slice(index, nextNewline);
    const parts = statement.split(' ');
    if(parts.length < 3) {
        console.warn('Set does not match expected values',scene.name, index, statement)
    }
    return <SetVariable>{
        type: 'SetVariable',
        index: index,
        name: parts[1].trim(),
        value: parts[2].trim(),
    };
}

export const createTempVariableParser: TokenParser<CreateTempVariable> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const statement = scene.content.slice(index, nextNewline);
    const parts = statement.split(' ');
    if(parts.length > 2) {
        return <CreateTempVariable>{
            type: 'CreateTempVariable',
            index: index,
            name: parts[1].trim(),
            value: parts[2].trim(),
        };
    }
    return <CreateTempVariable>{
        type: 'CreateTempVariable',
        index: index,
        name: parts[1].trim(),
    };
}

export const choiceParser: TokenParser<Choice> = (scene: Scene, index: number) => {
    return <Choice>{
        type: 'Choice',
        index: index,
    };
}

const calculateIndent = (content: string, index: number) => {
    let indent = 0;
    for (let i = 0; i < 32; i++) {
        if(content[index - i] === '\t'){
            indent++;
        }
        if(content[index - i] === ' '){
            indent += 0.5;
        }
        if(content[index - i] === '\n') {
            break;
        }
        if(content[index - i] === '\r') {
            break;
        }
    }
    return indent;
}

export const optionParser: TokenParser<Option> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const statement = scene.content.slice(index, nextNewline);
    return <Option>{
        type: 'Option',
        index: index,
        text: statement.replace('#', '').trim()
    };
}

export const fakeChoiceParser: TokenParser<FakeChoice> = (scene: Scene, index: number) => {
    return <FakeChoice>{
        type: 'FakeChoice',
        index: index,
    };
}

export const selectableIfParser: TokenParser<SelectableIf> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const nextOption = scene.content.indexOf('#', index);
    const nextStatement = scene.content.indexOf('*', index);
    const indexToSlice = [nextNewline, nextOption, nextStatement].filter(a => a !== -1).sort()[0];
    const statement = scene.content.slice(index, indexToSlice);
    return <SelectableIf>{
        type: 'SelectableIf',
        index: index,
        expression: statement.replace('*selectable_if', '').trim()
    };
}

export const ifParser: TokenParser<If> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const statement = scene.content.slice(index, nextNewline);
    return <If>{
        type: 'If',
        index: index,
        expression: statement.replace('*if', '').trim()
    };
}

export const elseIfParser: TokenParser<ElseIf> = (scene: Scene, index: number) => {
    const nextNewline = scene.content.indexOf('\n', index);
    const statement = scene.content.slice(index, nextNewline);
    return <ElseIf>{
        type: 'ElseIf',
        index: index,
        expression: statement.replace('*elseif', '').trim()
    };
}

export const elseParser: TokenParser<Else> = (scene: Scene, index: number) => {
    return <Else>{
        type: 'Else',
        index: index,
    };
}

export const endingParser: TokenParser<Ending> = (scene: Scene, index: number) => {
    return <Ending>{
        type: 'Ending',
        index: index,
    };
}
