import {Scene} from "./scene";
import {scanScene} from "./scanner";
import { scanLabelNames } from "./scan-label-names";
import { flattenProse } from "./flatten-prose";
import { ChoiceOptionToken, ProseToken, Token } from "./tokens";
import { outPath, ensureOutDir, getIO } from '../out-dir';
import { PrefixTrie } from "./expression-handler";

const execute = async () => {
    ensureOutDir();
    const scenes = JSON.parse(getIO().readFile(outPath('raw-scenes.json'))) as Scene[];
    console.info(`Loaded ${scenes.length} scenes`);

    const tokens = await scanScenes(scenes);
    console.log(`Writing ${tokens.length} scenes with total of ${tokens.flatMap(t=>t).length} tokens to ${outPath('scanned-tokens.json')}`);
    getIO().writeFile(outPath('scanned-tokens.json'), JSON.stringify(tokens, null, 2));
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
    const knownLabels = cleanedScenes.flatMap(scene => scanLabelNames(scene));
    const sceneNames = scenes.map(scene => scene.name);
    console.log(`Found ${knownLabels.length} labels, and ${sceneNames.length} scenes`,sceneNames);
    const labelTrie = new PrefixTrie(knownLabels);
    const sceneTrie = new PrefixTrie(sceneNames);
    const tokens = cleanedScenes
        .map(scene => {
            console.time(`scan ${scene.name}`);
            const { tokens: t } = scanScene(scene, labelTrie, sceneTrie);
            const flat = expandProse(t, labelTrie, sceneTrie);
            console.timeEnd(`scan ${scene.name}`);
            return flat;
        });
    return addIds(tokens);
}

const expandProse = (
    sceneTokens: Token[],
    knownLabels: string[] | PrefixTrie,
    sceneNames: string[] | PrefixTrie,
): Token[] => {
    const out: Token[] = [];
    for (const token of sceneTokens) {
        if (token.type === "Prose") {
            const prose = token as ProseToken;
            const flat = flattenProse(prose.content, {
                sceneName: token.sceneName,
                lineNumber: token.lineNumber,
                position: token.position,
                indent: token.indent,
                knownLabels,
                sceneNames,
            });
            // Ensure a leading Prose anchor token even if the content starts
            // with an inline opener, so dispatch on Prose still triggers.
            if (flat.length > 0 && flat[0].type !== "Prose") {
                out.push(<ProseToken>{
                    type: "Prose",
                    sceneName: token.sceneName,
                    lineNumber: token.lineNumber,
                    position: token.position,
                    indent: token.indent,
                    content: "",
                });
            }
            out.push(...flat);
        } else if (token.type === "ChoiceOption") {
            const opt = token as ChoiceOptionToken;
            out.push(opt);
            if (opt.rawText && opt.rawText.length > 0) {
                const flat = flattenProse(opt.rawText, {
                    sceneName: token.sceneName,
                    lineNumber: token.lineNumber,
                    position: token.position + 1,
                    indent: token.indent,
                    knownLabels,
                    sceneNames,
                });
                out.push(...flat);
            }
        } else {
            out.push(token);
        }
    }
    return out;
};

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
export { execute as runScan };