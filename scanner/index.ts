import {Scene} from "./scene";
import {scanScene} from "./scanner";
import fs from 'node:fs';
import { scanLabelNames } from "./scan-label-names";
import { Token } from "./tokens";

const execute = async () => {
    const startup = await loadScene('startup');
    const sceneNames = readSceneList(startup);
    const implicitControlFlow = startup.content.indexOf('*create implicit_control_flow true') !== -1;

    if (implicitControlFlow) {
        console.warn("Implicit Control Flow detected");
    }

    if(sceneNames.every(name => name !== 'startup')) {
        sceneNames.unshift('startup');
    }

    sceneNames.push('choicescript_stats');

    let scenes = await Promise.all(sceneNames.map(scene => loadScene(scene)));
    console.info(`Loaded ${scenes.length} scenes`);

    const tokens = await scanScenes(scenes);
    console.log(`Writing ${tokens.length} scenes with total of ${tokens.flatMap(t=>t).length} tokens to ./scanned-tokens.json`);
    fs.writeFileSync('./scanned-tokens.json', JSON.stringify(tokens, null, 2));
}

export const scanScenes = async (scenes: Scene[]) => {
    const cleanedScenes = scenes.filter(scene => scene.content !== '{"error":"couldn\'t find scene"}\n');
    // scan labels
    const knownLabels = cleanedScenes.map(scene => scanLabelNames(scene)).flatMap(s => s);
    const sceneNames = scenes.map(scene => scene.name);
    console.log(`Found ${knownLabels.length} labels, and ${sceneNames.length} scenes`,sceneNames);
    const tokens = cleanedScenes
        .map(scene => scanScene(scene, knownLabels, sceneNames));
    return addIds(tokens);
}

const addIds = (scenes: Token[][]) => {
    let currentId = 0;
    
    for (let scene of scenes) {
        for(let token of scene) {
            token.id = currentId;
            currentId++;
        }
    }

    return scenes;
}

export const loadScene = async (name: string) => {
    const sourceUrl = `${url}/scenes/${name}.txt`;
    const request = await fetch(sourceUrl);
    const content = await request.text();
    console.info(`Loaded Scene '${name}' from ${sourceUrl}, read ${content.length} characters.`)
    return <Scene>{
        name: name,
        sourceUrl: sourceUrl,
        content: content,
    }
}

export const readSceneList = (startup: Scene): string[] => {
    if(startup === undefined || startup.content === undefined || startup.content.length === 0){
        throw new Error('Cannot read empty or undefined scene');
    }
    const keywordLength = '*scene_list'.length;
    const startIndex = startup.content.indexOf('*scene_list');
    const nextStatementIndex = startup.content.indexOf('*', startIndex + keywordLength);
    const sceneList = startup.content.slice(startIndex + keywordLength, nextStatementIndex);
    const scenes = sceneList
        .split('\n')
        .map(scene => scene.trim())
        .filter(scene => scene.length > 0);
    console.info(`Found ${scenes.length} scenes`, scenes);
    return scenes;
}

//"https://cogdemos.ink/play/nutellaqueen/the-sword-of-rhivenia-public-demo/mygame"
//"https://cogdemos.ink/play/izzily/drink-your-villain-juice/mygame";
//"https://www.choiceofgames.com/user-contributed/fallen-hero-retribution/";
//"https://cogdemos.ink/play/cultivator-anon/aura-clash/mygame";
//"https://www.choiceofgames.com/user-contributed/eldritch-tales-inheritance/";
//"https://www.choiceofgames.com/user-contributed/blood-moon/";
// "https://cogdemos.ink/play/keeper/keeper-of-life-and-death/mygame";
let url = "https://cogdemos.ink/play/allie-%28monsoon-games%29/college-tennis-origin-story/mygame";;
await execute();