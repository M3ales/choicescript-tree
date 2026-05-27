import { Scene } from '../fetch/scene';
import { countIndentation } from '../scanner/indent';
import { ParseError } from './parse-error';
import { outPath, getIO } from '../out-dir';

const CONTEXT_LINES = 10;

const STATEMENT_SYNTAX: Record<string, string> = {
    Prose: "Prose Block",
    Choice: "*choice",
    FakeChoice: "*fake_choice",
    If: "*if",
    Else: "*else",
    GotoLabel: "*goto",
    GotoScene: "*goto_scene",
    Label: "*label",
    PageBreak: "*page_break",
    LineBreak: "*line_break",
    SetVariable: "*set",
    CreateVariable: "*create",
    CreateTempVariable: "*temp",
    Image: "*image",
    GoSub: "*gosub",
    Finish: "*finish",
    GoSubScene: "*gosub_scene",
    Return: "*return",
    Comment: "*comment",
    Ending: "*ending",
    Author: "*author",
    SceneList: "*scene_list",
    Achievement: "*achievement",
    Achieve: "*achieve",
    CheckAchievements: "*check_achievements",
    Link: "*link",
    GenerateRandom: "*rand",
    InputText: "*input_text",
    InputNumber: "*input_number",
    Parameters: "*params",
    StatChart: "*stat_chart",
    GameIdentifier: "*ifid",
    SaveCheckpoint: "*save_checkpoint",
    RestoreCheckpoint: "*restore_checkpoint",
};

let cachedScenes: Map<string, string> | null = null;

const loadScenes = (): Map<string, string> => {
    if (cachedScenes) return cachedScenes;
    const raw = getIO().readFile(outPath('raw-scenes.json'));
    const scenes = JSON.parse(raw) as Scene[];
    cachedScenes = new Map(scenes.map(s => [s.name, s.content]));
    return cachedScenes;
};

export const formatErrorWithContext = (error: ParseError): string => {
    const { sceneName, lineNumber, position } = error.token;
    const content = loadScenes().get(sceneName);

    if (content === undefined) {
        return `${error.message}\n  (source unavailable — scene not found in raw-scenes.json)`;
    }

    const lines = content.split('\n');
    const BEFORE = CONTEXT_LINES + 4;
    const AFTER = CONTEXT_LINES - 4;
    const start = Math.max(0, lineNumber - BEFORE);
    const end = Math.min(lines.length - 1, lineNumber + AFTER);
    const gutterWidth = String(end + 1).length;
    const indents = lines.slice(start, end + 1).map(l => countIndentation(l).indent);
    const indentWidth = Math.max(...indents.map(i => String(i).length));

    const hasPosition = position !== undefined && !Number.isNaN(position);

    const out: string[] = [];
    out.push("=".repeat(80));
    out.push("Error: " + error.message);
    out.push("-".repeat(80));

    for (let i = start; i <= end; i++) {
        if (i !== lineNumber && lines[i].trim().length === 0) continue;
        const lineNo = String(i + 1).padStart(gutterWidth, ' ');
        const indent = String(indents[i - start]).padStart(indentWidth, ' ');
        const marker = i === lineNumber ? '>' : ' ';
        out.push(`${marker} ${lineNo} ${indent} | ${lines[i]}`);
        if (i === lineNumber && hasPosition) {
            const pad = ' '.repeat(gutterWidth + indentWidth + 5 + position);
            out.push(`${pad}^`);
        }
    }

    out.push("-".repeat(80));

    if (error.context && error.context.length > 0) {
        out.push("while parsing:");
        for (let i = error.context.length - 1; i >= 0; i--) {
            const c = error.context[i];
            const label = STATEMENT_SYNTAX[c.kind] ?? c.kind;
            out.push(`  in ${label} (${c.token.sceneName}:${c.token.lineNumber}:${c.token.position})`);
        }
        out.push("-".repeat(80));
    }

    return out.join('\n');
};
