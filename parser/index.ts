import scenes from '../scanned-tokens.json';
import { Parser } from './parser';

const execute = async () => {
    console.log(`Loaded ${scenes.length} scenes from scanned-tokens.json`);

    const sceneTrees = [];
    for(const sceneTokens of scenes) {
        console.log(`Scene: ${sceneTokens[0].sceneName} :: Tokens: ${sceneTokens.length}`);
        const parser = new Parser(sceneTokens);
        const ast = parser.parse();
        
        sceneTrees.push(ast);
        // Stop if there was a syntax error.
        if (ast == null) return;
    }
};

await execute();
