import { remote } from "./remote";
import {Scene} from "./scene";
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

//"https://cogdemos.ink/play/nutellaqueen/the-sword-of-rhivenia-public-demo/mygame"
//"https://cogdemos.ink/play/izzily/drink-your-villain-juice/mygame";
//"https://www.choiceofgames.com/user-contributed/fallen-hero-retribution/";
//"https://cogdemos.ink/play/cultivator-anon/aura-clash/mygame";
//"https://www.choiceofgames.com/user-contributed/eldritch-tales-inheritance/";
//"https://www.choiceofgames.com/user-contributed/blood-moon/";
// "https://cogdemos.ink/play/keeper/keeper-of-life-and-death/mygame";
// "https://cogdemos.ink/play/allie-%28monsoon-games%29/college-tennis-origin-story/mygame";;

const loader = remote;
const location = "https://cogdemos.ink/play/barbara-truelove/thicker-than-demo/mygame";
let unreferencedScenes = [];

await execute();