import sceneTokens from '../scanned-tokens.json';
import { Token } from '../scanner/tokens';
import { formatErrorWithContext } from './error-with-context';
import { Parser } from './parser';
import { SceneAst } from './scene';
import * as fs from 'node:fs';
import { ChoiceOptionStatement, ProseStatement, Statement } from './statements';

const scenes = <Token[][]>sceneTokens;
const tokensByScene = new Map<string, Token[]>();
for (const sceneToks of scenes) {
    if (sceneToks.length === 0) continue;
    tokensByScene.set(sceneToks[0].sceneName, sceneToks);
}

const execute = async () => {
    console.log(`Loaded ${scenes.length} scenes from scanned-tokens.json`);
    const sceneAsts: SceneAst[] = [];
    const tokenStream: Token[] = scenes.flatMap(s => s);
    console.log(`Parsing AST from: ${tokenStream.length} tokens`);

    let totalErrors = 0;
    for(const scene of scenes) {
        const sceneName = scene[0]?.sceneName;
        console.time(`Parse ${sceneName}`);
        const parser = new Parser(scene);
        const ast = parser.parseScene();

        if (ast == null) {
            console.log('Null AST returned from parser, skipping.', scene[0]?.sceneName);
            continue;
        }

        sceneAsts.push(ast);

        if (ast.parseErrors?.length > 0) {
            for (const err of ast.parseErrors) {
                console.error(formatErrorWithContext(err));
            }
            totalErrors += ast.parseErrors.length;
        }
        console.timeEnd(`Parse ${sceneName}`);
    }

    if (totalErrors > 0) {
        console.error(`Parse completed with ${totalErrors} error(s) across ${sceneAsts.filter(s => (s.parseErrors?.length ?? 0) > 0).length} scene(s)`);
    }
    console.log(`Writing ${sceneAsts.length} scenes with total of ${countStatements(sceneAsts)} statements to ./parsed.json`);
    fs.writeFileSync('./parsed.json', JSON.stringify(sceneAsts, null, 2));
};

const countStatements = (sceneAsts: SceneAst[]) => {
    const countSegments = (statement: Statement) => {
        let count = 1;
        switch(statement.kind) {
            case "ChoiceOption": {
                const opt = statement as ChoiceOptionStatement;
                count += opt.parsedSegments?.length ?? 0;
            }
            case "Prose": {
                const prose = statement as ProseStatement;
                count += prose.parsedSegments?.length ?? 0;
            }
            default:
                break;
        }
        return count;
    }
    return sceneAsts.flatMap(f => f.statements.map(countSegments)).reduce((a,b) => a + b);
}

await execute();
