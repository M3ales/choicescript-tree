import {GotoLabel, GotoScene, Label, Scene, Token, tokeniseScenes} from "./parser";
import Graph from "graphology";

const execute = async () => {
    const startup = await loadScene('startup');
    const sceneNames = readSceneList(startup);
    const implicitControlFlow = startup.content.indexOf('*create implicit_control_flow true') !== -1;

    if (implicitControlFlow) {
        console.warn("Implicit Control Flow detected, this is unsupported at this time.");
    }

    let scenes = await Promise.all(sceneNames.map(scene => loadScene(scene)));
    console.info(`Loaded ${scenes.length} scenes`);

    const tokens = await tokeniseScenes(scenes);

    const graph = createDG(tokens);
    const graphExport = graph.export();
    
    console.log(graphExport);
}
export const createDG = (tokens: Token[]): Graph => {
    let tokenIndex = 0;
    const graph = new Graph({ allowSelfLoops: true, type: "directed" });
    const tokensMap = tokens.map(token => ({
        id: tokenIdentifier(token),
        token: token
    }));
    tokensMap
        .forEach(t => {
            graph.addNode(t.id, t.token)
        });
    
    while(true) {
        if(tokenIndex >= tokensMap.length) break;
        
        const current = tokensMap[tokenIndex];
        switch(current.token.type){
            case 'GotoScene': {
                const from = current.id;
                const gotoToken = current.token as GotoScene;
                const to = tokensMap.find(t => {
                    if(!gotoToken.targetLabel) {
                        return t.token.sceneName === gotoToken.sceneName && t.token.type === 'SceneStart';
                    }
                    return t.token.sceneName === gotoToken.target && t.token.type === 'Label' && gotoToken.targetLabel === (t.token as Label).name;
                });
                if(to === undefined) {
                    console.warn('Unable to find match for goto scene', gotoToken);
                    break;
                }
                graph.addDirectedEdgeWithKey(`${from}->${to}`, from, to);
                break;
            }
            case 'GotoLabel': {
                const from = current.id;
                const gotoToken = current.token as GotoLabel;
                const to = tokensMap.find(t => {
                    return t.token.sceneName === gotoToken.sceneName && t.token.type === 'Label' && (t.token as Label).name === gotoToken.target;
                });
                
                if(to === undefined) {
                    console.warn('Unable to find match for goto label', gotoToken);
                    break;
                }
                graph.addDirectedEdgeWithKey(`${from}->${to.id}`, from, to.id);
                break;
            }
            default: {
                
            }
        }
        
        tokenIndex++;
    }
    return graph;
}
const tokenIdentifier = (token: Token) => {
    return `${token.sceneName}:${token.lineNumber}:${token.position}:${token.type}`;
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


const url = "https://www.choiceofgames.com/user-contributed/fallen-hero-rebirth";
await execute();
