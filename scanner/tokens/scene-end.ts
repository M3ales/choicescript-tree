import { Token } from './token';

export interface SceneEnd extends Token {
    type: 'SceneEnd';
    sceneName: string;
    lineNumber: number;
    position: number;
    indent: number;
}