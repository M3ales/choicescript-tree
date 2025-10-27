import scenes from '../scanned-tokens.json';
import { Parser } from './parser';
import { Scene as SceneAst } from './scene';
import { Statement } from './statements';
import * as fs from 'node:fs';

const execute = async () => {
    console.log(`Loaded ${scenes.length} scenes from scanned-tokens.json`);

    const sceneAsts: SceneAst[] = [];
    for(const sceneTokens of scenes) {
        console.log(`Scene: ${sceneTokens[0].sceneName} :: Tokens: ${sceneTokens.length}`);
        const parser = new Parser(sceneTokens);
        const ast = parser.parseScene();
        
        sceneAsts.push(ast);
        // Stop if there was a syntax error.
        if (ast == null) return;
    }

    
    console.log(`Writing ${scenes.length} scenes with total of ${sceneAsts.flatMap(f => f).length} statements to ./parsed.json`);
    fs.writeFileSync('./parsed.json', JSON.stringify(sceneAsts, null, 2));
};

await execute();
