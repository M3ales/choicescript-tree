import scenes from '../scanned-tokens.json';
import { Token } from '../scanner/tokens';
import { Parser } from './parser';
import { Scene as SceneAst } from './scene';
import { Statement } from './statements';
import * as fs from 'node:fs';

const execute = async () => {
    console.log(`Loaded ${scenes.length} scenes from scanned-tokens.json`);

    const sceneAsts: SceneAst[] = [];
    const tokenStream: Token[] = scenes.flatMap(s => s);
    console.log(`Parsing AST from: ${tokenStream.length} tokens`);
    const parser = new Parser(tokenStream);
    const ast = parser.parseScene();
    
    sceneAsts.push(ast);
    // Stop if there was a syntax error.
    if (ast == null) return;

    
    console.log(`Writing ${scenes.length} scenes with total of ${sceneAsts.flatMap(f => f).length} statements to ./parsed.json`);
    fs.writeFileSync('./parsed.json', JSON.stringify(sceneAsts, null, 2));
};

await execute();
