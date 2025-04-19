// Core types for the ChoiceScript state machine

export type Position = {
    file: string;
    line: number;
};

export type Node = {
    id: string;
    type: string;
    text: string;
    attributes: Record<string, any>;
    position: Position;
    options?: ChoiceOption[];
};

export type ChoiceOption = {
    id: string;
    text: string;
    conditions: string[];
    isSelectable?: boolean; // For selectable_if cases
};

export type Edge = {
    source: string;
    target: string;
    attributes: {
        condition?: string;
        statChanges?: Array<{
            variable: string;
            operation: string;
            value: string;
        }>;
    };
    position: Position;
};

export type Graph = {
    nodes: Map<string, Node>;
    edges: Edge[];
    entryPoints: Map<string, string>;
    labels: Map<string, string>;
    metadata: GameMetadata;
};

export type GameMetadata = {
    title?: string;
    author?: string;
    sceneList: string[];
    variables: Map<string, Variable>;
    achievements: Achievement[];
};

export type Variable = {
    name: string;
    type: 'create' | 'temp' | string;
    dataType?: 'numeric' | 'string' | 'boolean' | string
    initialValue: string;
    description?: string;
};

export type Achievement = {
    id: string;
    name: string;
    visibility: 'visible' | 'hidden';
    points: number;
    description: string;
    earnedDescription: string;
};

export type ConditionalState = {
    condition: string;
    nodeBeforeIf: string;
    branchEndNodes: string[];
};

// Provider interface for loading ChoiceScript files
export interface SceneProvider {
    // Get a list of all scenes
    listScenes(): Promise<string[]>;

    // Load the content of a specific scene
    loadScene(sceneName: string): Promise<string>;

    // Check if a scene exists
    hasScene(sceneName: string): Promise<boolean>;
}