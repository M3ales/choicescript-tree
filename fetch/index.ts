import {Scene} from "./scene";
import fs from 'node:fs';

const execute = async () => {
    const startup = await loadScene('startup');
    const sceneNames = readSceneList(startup);

    if(sceneNames.every(name => name !== 'startup')) {
        sceneNames.unshift('startup');
    }

    sceneNames.push('choicescript_stats');

    let scenes = await Promise.all(sceneNames.map(scene => loadScene(scene)));
    console.info(`Loaded ${scenes.length} scenes`);
    console.log(`Writing ${scenes.length} to ./raw-scenes.json`);
    fs.writeFileSync('./raw-scenes.json', JSON.stringify(scenes, null, 2));
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
        timestamp: new Date(new Date().getTime())
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
let url = "https://cogdemos.ink/play/barbara-truelove/thicker-than-demo/mygame" // "https://cogdemos.ink/play/allie-%28monsoon-games%29/college-tennis-origin-story/mygame";;
await execute();