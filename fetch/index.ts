import { remote } from "./remote";
import { local } from "./local";
import {Scene} from "./scene";
import { SceneLoader } from "./scene-loader";
import fs from 'node:fs';

const execute = async () => {
    const startup = await loader.loadScene('startup', location);
    const sceneNames = readSceneList(startup);

    for(let scene of unreferencedScenes) {
        if(sceneNames.find(s => s === scene)) {
            continue;
        }
        sceneNames.push(scene);
    }

    if(sceneNames.every(name => name !== 'startup')) {
        sceneNames.unshift('startup');
    }

    sceneNames.push('choicescript_stats');

    let scenes = await Promise.all(sceneNames.map(scene => loader.loadScene(scene, location)));
    
    console.info(`Loaded ${scenes.length} scenes`);
    console.log(`Writing ${scenes.length} to ./raw-scenes.json`);
    fs.writeFileSync('./raw-scenes.json', JSON.stringify(scenes, null, 2));
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
    console.info(`Found ${scenes.length} scenes in *scene_list`, scenes);
    return scenes;
}

const [typeArg, locationArg, unreferencedScenesRaw] = process.argv.slice(2);
if (!typeArg || !locationArg) {
    console.error('Usage: npm run fetch -- <remote|local> <location> <unreferencedScenes>');
    process.exit(1);
}

const loaders: Record<string, SceneLoader> = { remote, local };
const loader = loaders[typeArg];
if (!loader) {
    console.error(`Unknown loader type '${typeArg}'. Expected 'remote' or 'local'.`);
    process.exit(1);
}

const location = locationArg;
let unreferencedScenes = unreferencedScenesRaw?.split(',') ?? [];

await execute();