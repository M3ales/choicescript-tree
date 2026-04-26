export interface Scene {
    name: string;
    content: string;
    sourceUrl: string;
    timestamp: Date;
}

export interface SceneLoadError extends Scene {
    name: string;
    content: string;
    sourceUrl: string;
    timestamp: Date;
    error: { message: string, code: number };
}