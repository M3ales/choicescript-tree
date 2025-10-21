import scenes from '../scanned-tokens.json';
import { Parser } from './parser';

const execute = async () => {
    console.log(`Loaded ${scenes.length} scenes from scanned-tokens.json`);

    for(const sceneTokens of scenes) {
        console.log(`Scene: ${sceneTokens[0].sceneName} :: Tokens: ${sceneTokens.length}`);
        const parser = new Parser(sceneTokens);
        const expression = parser.parse();
    
        // Stop if there was a syntax error.
        if (expression == null) return;
    }
};

await execute();
