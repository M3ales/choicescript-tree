import { Scene } from "../scene";
import { SceneLoader } from "../scene-loader";
import { readFile } from 'node:fs/promises';

export const local: SceneLoader = {
    loadScene: async (sceneName: string, location: string) => {
        const sceneLocation = `${location}/scenes/${sceneName}.txt`;
        const content = await readFile(sceneLocation, 'utf8');
        console.info(`Loaded Scene '${sceneName}' from ${sceneLocation}, read ${content.length} characters.`)
        return <Scene>{
            name: sceneName,
            sourceUrl: sceneLocation,
            content: content,
            timestamp: new Date(new Date().getTime())
        }
    }
};