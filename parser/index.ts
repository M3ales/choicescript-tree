import sceneTokens from '../scanned-tokens.json';
import { Token } from '../scanner/tokens';
import { Parser } from './parser';
import { SceneAst } from './scene';
import * as fs from 'node:fs';

const scenes = <Token[][]>sceneTokens;

const execute = async () => {
    console.log(`Loaded ${scenes.length} scenes from scanned-tokens.json`);
    const sceneAsts: SceneAst[] = [];
    const tokenStream: Token[] = scenes.flatMap(s => s);
    console.log(`Parsing AST from: ${tokenStream.length} tokens`);

    for(const scene of scenes) {
        const parser = new Parser(scene);
        const ast = parser.parseScene();
    
        sceneAsts.push(ast);
        // Stop if there was a syntax error.
        if (ast == null) {
            console.log('Null AST returned from parser, stopping further parsing.', scene[0].sceneName);
        };
    }
    
    console.log(`Writing ${scenes.length} scenes with total of ${sceneAsts.flatMap(f => f.statements).length} statements to ./parsed.json`);
    fs.writeFileSync('./parsed.json', JSON.stringify(sceneAsts, null, 2));
};

await execute();
