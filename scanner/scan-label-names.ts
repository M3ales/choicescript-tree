import { Scene } from "./scene";

export const scanLabelNames = (scene: Scene): string[] => {
    const labels: string[] = [];
    const content = scene.content;
    let i = 0;
    while (i < content.length) {
        const nlIdx = content.indexOf('\n', i);
        const lineEnd = nlIdx === -1 ? content.length : nlIdx;
        let lineStart = i;
        while (lineStart < lineEnd && (content[lineStart] === ' ' || content[lineStart] === '\t')) lineStart++;
        if (content.startsWith('*label', lineStart)) {
            let labelStart = lineStart + 6;
            while (labelStart < lineEnd && (content[labelStart] === ' ' || content[labelStart] === '\t')) labelStart++;
            let labelEnd = labelStart;
            while (labelEnd < lineEnd && content[labelEnd] !== ' ' && content[labelEnd] !== '\t') labelEnd++;
            if (labelEnd > labelStart) {
                labels.push(content.substring(labelStart, labelEnd).toLowerCase());
            }
        }
        i = nlIdx === -1 ? content.length : nlIdx + 1;
    }
    return labels;
}