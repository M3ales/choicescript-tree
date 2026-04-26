import {Scene} from "./scene";
import {scanScene} from "./scanner";
import fs from 'node:fs';
import { scanLabelNames } from "./scan-label-names";
import { Token } from "./tokens";
import scenesRaw from '../raw-scenes.json';

const execute = async () => {
    const scenes = scenesRaw as unknown as Scene[];
    console.info(`Loaded ${scenes.length} scenes`);

    const tokens = await scanScenes(scenes);
    console.log(`Writing ${tokens.length} scenes with total of ${tokens.flatMap(t=>t).length} tokens to ./scanned-tokens.json`);
    fs.writeFileSync('./scanned-tokens.json', JSON.stringify(tokens, null, 2));
}

export const scanScenes = async (scenes: Scene[]) => {
    const cleanedScenes: Scene[] = [];
    const skipped: Scene[] = [];
    for (const scene of scenes) {
        if (scene.error !== undefined) {
            console.warn(`[scan] Skipping scene '${scene.name}' due to ${scene.error.message} [${scene.error.code}] (${scene.sourceUrl})`);
            skipped.push(scene);
            continue;
        }
        cleanedScenes.push(scene);
    }
    if (skipped.length > 0) {
        console.warn(`[scan] Skipped ${skipped.length} of ${scenes.length} scene(s) due to missing/error content: ${skipped.map(s => s.name).join(', ')}`);
    }

    // scan labels
    const knownLabels = cleanedScenes.map(scene => scanLabelNames(scene)).flatMap(s => s);
    const sceneNames = scenes.map(scene => scene.name);
    console.log(`Found ${knownLabels.length} labels, and ${sceneNames.length} scenes`,sceneNames);
    const tokens = cleanedScenes
        .map(scene => {
            console.time(`scan ${scene.name}`);
            const t = scanScene(scene, knownLabels, sceneNames);
            console.timeEnd(`scan ${scene.name}`);
            return t;
        });
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
await execute();