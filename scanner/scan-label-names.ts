import { Scene } from "./scene";

export const scanLabelNames = (scene: Scene): string[] => {
    const sceneContent = scene.content.split('\n');
    return sceneContent
        .map((line: string) => line.trim())
        .filter((line: string) => line.includes("*label"))
        .map((line: string) => line.split('*label')[1].trim())
        .map((line: string) => {
            if(line.includes(' '))
                return line.split(' ')[0]
            return line;
        })
        .filter(label => label.length > 0);
}