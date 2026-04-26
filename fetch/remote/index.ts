import { NOT_FOUND } from "../error-codes";
import {Scene, SceneLoadError} from "../scene";
import { SceneLoader } from "../scene-loader";

const snippet = (text: string, max = 80) => {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
};

export const remote: SceneLoader = {
    loadScene: async (name: string, location: string) => {
        const sourceUrl = `${location}/scenes/${name}.txt`;
        const request = await fetch(sourceUrl);
        const contentType = request.headers.get('content-type') ?? '';
        const rawContent = await request.text();

        const isHtmlError = contentType.toLowerCase().includes('html');
        if (!request.ok || isHtmlError) {
            console.warn(`Scene '${name}' failed to load`, request.status, request.statusText);
            return <SceneLoadError>{
                name: name,
                sourceUrl: sourceUrl,
                content: rawContent,
                timestamp: new Date(new Date().getTime()),
                error: {
                    message: isHtmlError ? 
                    'Returned page was html, not a choicescript scene.' : 
                    `Request for the choicescript scene was rejected with ${request.status}: ${request.statusText} (${contentType})`,
                    code: NOT_FOUND
                }
            };
        }

        console.info(`Loaded Scene '${name}' from ${sourceUrl}, read ${rawContent.length} characters.`)
        return <Scene>{
            name: name,
            sourceUrl: sourceUrl,
            content: rawContent,
            timestamp: new Date(new Date().getTime())
        }
    }
};