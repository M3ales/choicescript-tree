import { Scene, SceneLoadError } from "./scene";

export class SceneLoader {
    loadScene: (name: string, location: string) => Promise<Scene | SceneLoadError>
}