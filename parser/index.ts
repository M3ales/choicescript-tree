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

    let totalErrors = 0;
    for(const scene of scenes) {
        const parser = new Parser(scene);
        const ast = parser.parseScene();

        if (ast == null) {
            console.log('Null AST returned from parser, skipping.', scene[0]?.sceneName);
            continue;
        }

        sceneAsts.push(ast);

        if (ast.parseErrors?.length > 0) {
            console.log(`  ${ast.name}: ${ast.parseErrors.length} parse error(s)`);
            totalErrors += ast.parseErrors.length;
        }
    }

    if (totalErrors > 0) {
        console.log(`Completed with ${totalErrors} parse error(s) across ${sceneAsts.filter(s => (s.parseErrors?.length ?? 0) > 0).length} scene(s)`);
    }
    console.log(`Writing ${sceneAsts.length} scenes with total of ${sceneAsts.flatMap(f => f.statements).length} statements to ./parsed.json`);
    fs.writeFileSync('./parsed.json', JSON.stringify(sceneAsts, null, 2));
};

await execute();
