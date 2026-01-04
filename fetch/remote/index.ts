import {Scene} from "../scene";
import { SceneLoader } from "../scene-loader";

export const remote: SceneLoader = {
    loadScene: async (name: string, location: string) => {
        const sourceUrl = `${location}/scenes/${name}.txt`;
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
};