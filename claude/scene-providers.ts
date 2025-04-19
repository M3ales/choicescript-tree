// Implementations of the SceneProvider interface

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { SceneProvider } from './types';

// File system utilities
const readDir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * FileSystemSceneProvider - Loads scenes from the local file system
 */
export class FileSystemSceneProvider implements SceneProvider {
    private basePath: string;
    private fileExtension: string;

    /**
     * Create a new FileSystemSceneProvider
     * @param basePath Directory containing the ChoiceScript scene files
     * @param fileExtension File extension for scene files (default: .txt)
     */
    constructor(basePath: string, fileExtension: string = '.txt') {
        this.basePath = basePath;
        this.fileExtension = fileExtension.startsWith('.') ? fileExtension : `.${fileExtension}`;
    }

    /**
     * Get a list of all available scenes in the directory
     */
    async listScenes(): Promise<string[]> {
        const files = await readDir(this.basePath);

        // Find all files with the correct extension and remove extension from name
        const scenes = await Promise.all(
            files.map(async (file) => {
                const filePath = path.join(this.basePath, file);
                const fileStat = await stat(filePath);

                if (fileStat.isFile() && file.endsWith(this.fileExtension)) {
                    return file.slice(0, -this.fileExtension.length);
                }

                return null;
            })
        );

        // Filter out non-scene files
        return scenes.filter((scene): scene is string => scene !== null);
    }

    /**
     * Load the content of a specific scene
     * @param sceneName The name of the scene without file extension
     */
    async loadScene(sceneName: string): Promise<string> {
        const filePath = this.getSceneFilePath(sceneName);

        try {
            const content = await readFile(filePath, 'utf8');
            return content;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`Scene '${sceneName}' does not exist`);
            }
            throw new Error(`Failed to load scene '${sceneName}': ${error.message}`);
        }
    }

    /**
     * Check if a scene exists
     * @param sceneName The name of the scene without file extension
     */
    async hasScene(sceneName: string): Promise<boolean> {
        const filePath = this.getSceneFilePath(sceneName);

        try {
            // Using fs.access instead of fs.exists to avoid race conditions
            await access(filePath, fs.constants.F_OK);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the full file path for a scene
     * @param sceneName The name of the scene without file extension
     */
    private getSceneFilePath(sceneName: string): string {
        return path.join(this.basePath, `${sceneName}${this.fileExtension}`);
    }
}

/**
 * MemorySceneProvider - Loads scenes from in-memory content
 * Useful for testing or when scenes are loaded from non-file sources
 */
export class MemorySceneProvider implements SceneProvider {
    private scenes: Map<string, string>;

    /**
     * Create a new MemorySceneProvider
     * @param scenes Optional initial map of scene names to content
     */
    constructor(scenes?: Record<string, string>) {
        this.scenes = new Map<string, string>();

        if (scenes) {
            Object.entries(scenes).forEach(([name, content]) => {
                this.scenes.set(name, content);
            });
        }
    }

    /**
     * Add or update a scene in memory
     * @param sceneName The name of the scene
     * @param content The content of the scene
     */
    addScene(sceneName: string, content: string): void {
        this.scenes.set(sceneName, content);
    }

    /**
     * Get a list of all available scenes in memory
     */
    async listScenes(): Promise<string[]> {
        return Array.from(this.scenes.keys());
    }

    /**
     * Load the content of a specific scene from memory
     * @param sceneName The name of the scene
     */
    async loadScene(sceneName: string): Promise<string> {
        const content = this.scenes.get(sceneName);

        if (content === undefined) {
            throw new Error(`Scene '${sceneName}' not found`);
        }

        return content;
    }

    /**
     * Check if a scene exists in memory
     * @param sceneName The name of the scene
     */
    async hasScene(sceneName: string): Promise<boolean> {
        return this.scenes.has(sceneName);
    }
}

/**
 * HttpSceneProvider - Loads scenes from HTTP/HTTPS URLs
 */
export class HttpSceneProvider implements SceneProvider {
    private baseUrl: string;
    private fileExtension: string;
    private sceneCache: Map<string, string>;
    private headers?: Record<string, string>;

    /**
     * Create a new HttpSceneProvider
     * @param baseUrl Base URL where scenes are located
     * @param fileExtension File extension for scene files (default: .txt)
     * @param headers Optional HTTP headers to include with requests
     */
    constructor(
        baseUrl: string,
        fileExtension: string = '.txt',
        headers?: Record<string, string>
    ) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        this.fileExtension = fileExtension.startsWith('.') ? fileExtension : `.${fileExtension}`;
        this.sceneCache = new Map<string, string>();
        this.headers = headers;
    }

    /**
     * Get a list of all available scenes
     * Parses the scene_list from startup.txt instead of requiring a separate index file
     */
    async listScenes(): Promise<string[]> {
        try {
            // First, check if we can load the startup.txt file
            if (!await this.hasScene('startup')) {
                console.error('startup.txt not found');
                return [];
            }

            // Load and parse startup.txt to extract the scene list
            const startupContent = await this.loadScene('startup');
            const scenes = this.extractScenesFromStartup(startupContent);

            // Always include startup in the scene list
            if (!scenes.includes('startup')) {
                scenes.unshift('startup');
            }

            return scenes;
        } catch (error) {
            console.error('Error listing scenes:', error);
            return [];
        }
    }

    /**
     * Extract scene list from startup.txt content
     * @param content The content of startup.txt
     * @returns Array of scene names
     */
    private extractScenesFromStartup(content: string): string[] {
        const scenes: string[] = [];

        // Parse the file line by line
        const lines = content.split('\n');
        let inSceneList = false;
        let sceneListIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trimEnd(); // Keep left indentation
            const trimmedLine = line.trim();

            // Look for the scene_list command
            if (trimmedLine === '*scene_list') {
                inSceneList = true;

                // Find the indentation of the first scene in the list
                for (let j = i + 1; j < lines.length; j++) {
                    const nextLine = lines[j];
                    if (nextLine.trim() === '') continue;

                    const match = RegExp(/^(\s+)\S/).exec(nextLine);
                    if (match) {
                        sceneListIndent = match[1].length;
                        break;
                    } else {
                        // No indentation found, scene_list is empty or next line is a command
                        inSceneList = false;
                        break;
                    }
                }
            }
            // Collect scene names from the indented list
            else if (inSceneList && RegExp(new RegExp(`^\\s{${sceneListIndent}}\\S`)).exec(line)) {
                const sceneName = trimmedLine;
                scenes.push(sceneName);
            }
            // End of scene_list when indentation changes or we hit another command
            else if (inSceneList && trimmedLine !== '' &&
                (!line.match(new RegExp(`^\\s{${sceneListIndent}}\\S`)) || trimmedLine.startsWith('*'))) {
                inSceneList = false;
            }
        }

        return scenes;
    }

    /**
     * Load the content of a specific scene
     * @param sceneName The name of the scene without file extension
     */
    async loadScene(sceneName: string): Promise<string> {
        // Check cache first
        if (this.sceneCache.has(sceneName)) {
            return this.sceneCache.get(sceneName);
        }

        const url = `${this.baseUrl}${sceneName}${this.fileExtension}`;

        try {
            const response = await fetch(url, {
                headers: this.headers
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch scene '${sceneName}': ${response.statusText}`);
            }

            const content = await response.text();

            // Cache the result
            this.sceneCache.set(sceneName, content);

            return content;
        } catch (error) {
            throw new Error(`Failed to load scene '${sceneName}': ${error}`);
        }
    }

    /**
     * Check if a scene exists
     * @param sceneName The name of the scene without file extension
     */
    async hasScene(sceneName: string): Promise<boolean> {
        // Check cache first
        if (this.sceneCache.has(sceneName)) {
            console.debug(`Scene '${sceneName}' found in cache`);
            return true;
        }

        const url = `${this.baseUrl}${sceneName}${this.fileExtension}`;

        console.debug('Attempting to find scene at', url);
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                headers: this.headers
            });

            console.debug('Found scene at', url);
            return response.ok;
        } catch (error) {
            console.debug('Error finding scene at', url, error);
            return false;
        }
    }

    /**
     * Clear the scene cache
     */
    clearCache(): void {
        this.sceneCache.clear();
    }
}