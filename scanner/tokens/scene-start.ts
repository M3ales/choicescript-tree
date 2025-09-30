import { Token } from './token';

export interface SceneStart extends Token {
    type: 'SceneStart';
    sceneName: string;
    lineNumber: number;
    position: number;
    indent: number;
}