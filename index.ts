import {GotoLabel, GotoScene, Label, parseScenesToTokensInPlace, Scene, Token} from "./parser";

const execute = async () => {
    const startup = await loadScene('startup');
    const sceneNames = readSceneList(startup);
    const implicitControlFlow = startup.content.indexOf('*create implicit_control_flow true') !== -1;

    if(implicitControlFlow) {
        console.warn("Implicit Control Flow detected, this is unsupported at this time.");
    }

    let scenes = await Promise.all(sceneNames.map(scene => loadScene(scene)));
    console.info(`Loaded ${scenes.length} scenes`);

    scenes = await parseScenesToTokensInPlace(scenes);
    
    let endingReached = false;
    let sceneIndex = 0;
    let flowIndex = 0;
    let currentScene = scenes[sceneIndex];
    let choiceIndent = 0;
    let inChoice = false;
    let fakeChoiceIndent = 0;
    let inFakeChoice = false;
    
    const edges: { from: Token, to: Token }[] = [];
    const visited = [];
    while(!endingReached) {
        if(flowIndex >= currentScene.flow.length) {
            if(sceneIndex >= scenes.length) {
                endingReached = true;
                break;
            }
            console.info(`Reached end of scene flow without encountering a finish statement, moving to ${sceneIndex+1} ${scenes[sceneIndex+1]?.name}:0`);
            do {
                sceneIndex++;
                flowIndex = 0;
                currentScene = scenes[sceneIndex];
            } while((currentScene?.flow === undefined || currentScene.flow.length === 0) && sceneIndex <= scenes.length);
            if(sceneIndex === scenes.length) {
                endingReached = true;
                break;
            }
        }
        
        const currentToken = currentScene?.flow[flowIndex];
        if(currentScene === undefined) {
            endingReached = true;
            break;
        }
        if(currentToken.indent < choiceIndent) {
            inChoice = false;
        }
        if(currentToken.indent < fakeChoiceIndent) {
            inFakeChoice = false;
        }
        switch(currentToken.type) {
           case 'Choice': {
               choiceIndent = currentToken.indent + 1;
               inChoice = true;
               continue;
           }
           case 'FakeChoice': {
               fakeChoiceIndent = currentToken.indent + 1;
               inFakeChoice = true;
               continue;
           }
           case 'Ending': {
               console.info(`Encountered Ending at ${currentScene.name}:${currentToken.index}, done.`);
               edges.push({ from: currentToken, to: undefined})
               endingReached = true;
               continue;
           }
           case 'Finish': {
               edges.push({ from: currentToken, to: scenes[sceneIndex+1].flow[0]})
               console.info(`Encountered Finish at ${currentScene.name}:${currentToken.index} moving to ${scenes[sceneIndex+1].name}:0`);
               sceneIndex++;
               flowIndex = 0;
               currentScene = scenes[sceneIndex];
               visited.push(currentToken);
               continue;
           }
           case 'GotoLabel': {
               if(visited.includes(currentToken)) {
                   flowIndex++;
                   continue;
               }
               
               const targetLabelIndex = currentScene.flow
                   .findIndex(token => token.type === 'Label' && (<Label>token).name === (<GotoLabel>currentToken).target);
               if(currentScene.flow[targetLabelIndex] === undefined) {
                   console.error(`Unable to find matching label for *goto ${currentToken.target} at ${currentScene.name}:${currentToken.index}`);
                   flowIndex++;
                   continue;
               }
               edges.push({ from: currentToken, to: currentScene.flow[targetLabelIndex]});

               console.info(`Linking label goto ${currentScene.name}:${currentToken.index} to ${currentScene.name}:${currentScene.flow[targetLabelIndex].index}`);
               flowIndex = targetLabelIndex;
               visited.push(currentToken);
               continue;
           }
           case 'GotoScene': {
               if(visited.includes(currentToken)) {
                   flowIndex++;
                   continue;
               }
               const targetSceneIndex = scenes
                   .findIndex(scene => scene.name === (<GotoScene>currentToken).target);
               if(targetSceneIndex === -1) {
                   console.error(`Cant find scene for *goto_scene '${currentToken.target}' referenced at ${currentScene.name}:${currentToken.index}`);
                   flowIndex++;
                   continue;
               }
               
               let targetLabelIndex = scenes[targetSceneIndex].flow
                   .findIndex(token => token.type === 'Label' && (<Label>token).name === (<GotoScene>currentToken).targetLabel);

               if(currentToken.targetLabel === undefined) {
                   targetLabelIndex = 0;
               }
               
               if(targetLabelIndex === -1) {
                   throw new Error(`Unable to find matching label for *goto_scene ${currentToken.target} ${currentToken.targetLabel}, at ${currentScene.name}:${currentToken.index}`);
               }
               
               console.info(`Linking scene goto ${currentScene.name}:${currentToken.index} to ${scenes[targetSceneIndex].name}:${scenes[targetSceneIndex]?.flow[targetLabelIndex]?.index}`);
               edges.push({ from: currentToken, to: scenes[targetSceneIndex].flow[targetLabelIndex] });
               
               sceneIndex = targetSceneIndex;
               flowIndex = targetLabelIndex;
               visited.push(currentToken);
               continue;
           }
           default: {
               flowIndex++;
               visited.push(currentToken);
               continue;
           }
        }
    }

    // TODO: Generate Directed Graph
    // TODO: Render Graph
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
