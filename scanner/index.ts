import {Scene} from "./scene";
import {scanScene} from "./scanner";
import fs from 'node:fs';

const execute = async () => {
    const startup = await loadScene('startup');
    const sceneNames = readSceneList(startup);
    const implicitControlFlow = startup.content.indexOf('*create implicit_control_flow true') !== -1;

    if (implicitControlFlow) {
        console.warn("Implicit Control Flow detected");
    }

    let scenes = await Promise.all(sceneNames.map(scene => loadScene(scene)));
    console.info(`Loaded ${scenes.length} scenes`);

    const tokens = await scanScenes(scenes);
    console.log(`Writing ${tokens.length} scenes with total of ${tokens.flatMap(t=>t).length} tokens to ./scanned-tokens.json`);
    fs.writeFileSync('./scanned-tokens.json', JSON.stringify(tokens, null, 2));
}

export const scanScenes = async (scenes: Scene[]) => {
    const cleanedScenes = scenes.filter(scene => scene.content !== '{"error":"couldn\'t find scene"}\n');
    return cleanedScenes.map(scene => scanScene(scene));
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


const url = "https://cogdemos.ink/play/izzily/drink-your-villain-juice/mygame";
await execute();
