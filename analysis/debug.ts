import { Token } from "../scanner/tokens";

export const tokenPosition = (token: Token) => {
    return `${token.sceneName}:${token.lineNumber}:${token.position}`;
}

