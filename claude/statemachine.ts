// state-machine.ts - Main implementation of the ChoiceScript state machine

import {Achievement, ConditionalState, Graph, Position, SceneProvider, Variable} from './types';
import {parseCommand} from "./command-parser";
import {extractOptionPrefixes} from "./choice-parser";

/**
 * ChoiceScript State Machine - Parses ChoiceScript and builds a graph representation
 */
export class ChoiceScriptStateMachine {
    // Processing states
    private readonly states = {
        READING_TEXT: 'READING_TEXT',
        COMMAND: 'COMMAND',
        CHOICE_BLOCK: 'CHOICE_BLOCK',
        CONDITIONAL: 'CONDITIONAL',
        SUBROUTINE: 'SUBROUTINE',
        SCENE_LIST: 'SCENE_LIST',
        RANDOM_SCENE_LIST: 'RANDOM_SCENE_LIST',
        STAT_CHART: 'STAT_CHART'
    };

    // Context tracking
    private currentState: string;
    private position: Position;
    private currentNode: string | null;
    private textBuffer: string;
    private choiceNodeStack: string[];
    private conditionalStack: ConditionalState[];
    private variables: Map<string, Variable>;
    private executionMode: string;
    private subroutineStack: string[];
    private inAchievementBlock: boolean;
    private currentAchievement: Partial<Achievement> | null;

    // Indentation tracking
    private currentIndentLevel: number = 0;
    private expectedIndentLevel: number = 0;
    private indentSize: number | null = null; // Will be determined from the first indented line
    private lastIndentationType: 'space' | 'tab' | null = null;
    private commandRequiringIndent: boolean = false;

    // Graph structure
    private graph: Graph;
    private nodeIdCounter: number;

    // Scene provider
    private sceneProvider: SceneProvider;
    private processedScenes: Set<string>;

    /**
     * Create a new ChoiceScriptStateMachine
     * @param sceneProvider Provider for loading ChoiceScript scene files
     */
    constructor(sceneProvider: SceneProvider) {
        // Initialize state
        this.currentState = this.states.READING_TEXT;

        // Context tracking
        this.position = { file: '', line: 0 };
        this.currentNode = null;
        this.choiceNodeStack = [];
        this.textBuffer = '';
        this.conditionalStack = [];
        this.variables = new Map();
        this.executionMode = 'normal';
        this.subroutineStack = [];
        this.inAchievementBlock = false;
        this.currentAchievement = null;

        // Graph structure
        this.graph = {
            nodes: new Map(),
            edges: [],
            entryPoints: new Map(),
            labels: new Map(),
            metadata: {
                sceneList: [],
                variables: new Map<string, Variable>(),
                achievements: []
            }
        };

        this.nodeIdCounter = 0;

        // Scene provider
        this.sceneProvider = sceneProvider;
        this.processedScenes = new Set();
    }

    /**
     * Process a game starting from the entry scene (usually 'startup')
     * @param entryScene The name of the entry scene file without extension
     * @param processAllScenes Whether to process all linked scenes recursively
     */
    async processGame(entryScene: string = 'startup', processAllScenes: boolean = true): Promise<Graph> {
        // Reset the state machine
        this.resetState();

        console.debug('Processing Game starting at', entryScene);
        await this.processScene(entryScene);

        // If we should process all scenes recursively
        if (processAllScenes) {
            console.debug('Processing Linked Scenes Recursively starting at', entryScene);
            await this.processAllLinkedScenes();
        }

        return this.graph;
    }

    /**
     * Process all scenes that are linked from already processed scenes
     */
    private async processAllLinkedScenes(): Promise<void> {
        let processedSceneCount = 0;

        // Keep processing until we don't find any new scenes
        do {
            processedSceneCount = this.processedScenes.size;

            // Find all scene references in goto_scene and gosub_scene nodes
            const sceneRefs = new Set<string>();

            for (const [_, node] of this.graph.nodes) {
                if(node.type === 'scene_list' && node.attributes.scenes) {
                    for (const scene of node.attributes.scenes) {
                        sceneRefs.add(scene)
                    }
                    break;
                }
                /*
                if ((node.type === 'goto' || node.type === 'gosub') && node.attributes.sceneName) {
                    console.debug('Link to', node.attributes.sceneName);
                    sceneRefs.add(node.attributes.sceneName);
                }
                */
            }

            // Process any scenes that haven't been processed yet
            const promises: Promise<void>[] = [];

            for (const sceneName of sceneRefs) {
                if (!this.processedScenes.has(sceneName)) {
                    console.debug('Processing',sceneName)
                    await this.processScene(sceneName);
                    break;
                }
            }
        } while (processedSceneCount !== this.processedScenes.size);
    }

    /**
     * Process a single ChoiceScript scene file
     * @param sceneName The name of the scene file without extension
     */
    async processScene(sceneName: string): Promise<void> {
        // Check if the scene exists
        if (!await this.sceneProvider.hasScene(sceneName)) {
            console.warn(`Scene '${sceneName}' not found.`);
            return;
        }

        // Skip if already processed
        if (this.processedScenes.has(sceneName)) {
            return;
        }

        console.debug('Processing Scene', sceneName);
        
        // Mark as processed
        this.processedScenes.add(sceneName);

        // Update position
        this.position = { file: sceneName, line: 0 };

        // Create an entry node for this scene
        const entryNodeId = this.createNode('scene_entry', `Entry point for ${sceneName}`);
        this.graph.entryPoints.set(sceneName, entryNodeId);

        // If this is the first scene, set it as the current node
        if (this.currentNode === null) {
            this.currentNode = entryNodeId;
        }

        // Load and process the scene content
        try {
            const content = await this.sceneProvider.loadScene(sceneName);
            this.processContent(content);
        } catch (error) {
            console.error(`Error processing scene '${sceneName}':`, error);
        }
    }

    /**
     * Process the content of a ChoiceScript file
     * @param content The file content as a string
     */
    private processContent(content: string): void {
        // Split file content into lines
        const lines = content.split('\n');

        // Process each line
        lines.forEach((line, index) => {
            this.position.line = index + 1;
            this.processLine(line);
        });

        // Flush any remaining text in buffer
        this.flushTextBuffer();
    }

    /**
     * Process a single line of ChoiceScript
     * @param line The line of ChoiceScript to process
     */
    private processLine(line: string): void {
        // Track indentation
        const indentMatch = line.match(/^(\s*)/);
        const indentation = indentMatch ? indentMatch[1] : '';

        // Detect indentation type and size on first indented line
        if (indentation.length > 0 && this.indentSize === null) {
            if (indentation.includes('\t')) {
                this.lastIndentationType = 'tab';
                this.indentSize = 1; // One tab per level
            } else {
                this.lastIndentationType = 'space';
                this.indentSize = indentation.length; // Number of spaces in first indent
            }
        }

        // Validate consistent indentation type
        if (indentation.length > 0) {
            const currentType = indentation.includes('\t') ? 'tab' : 'space';
            if (this.lastIndentationType !== null && currentType !== this.lastIndentationType) {
                console.warn(`Inconsistent indentation type at ${this.position.file}:${this.position.line}. Mixing tabs and spaces.`);
            }
            this.lastIndentationType = currentType;
        }

        // Calculate current indent level
        if (this.indentSize && this.indentSize > 0) {
            this.currentIndentLevel = indentation.length / (this.lastIndentationType === 'tab' ? 1 : this.indentSize);
        } else {
            this.currentIndentLevel = 0;
        }

        // Check if indentation matches expectations for commands requiring indent
        if (this.commandRequiringIndent && this.currentIndentLevel !== this.expectedIndentLevel) {
            console.warn(`Expected indentation level ${this.expectedIndentLevel} but got ${this.currentIndentLevel} at ${this.position.file}:${this.position.line}`);
        }

        // Reset command requiring indent flag
        this.commandRequiringIndent = false;

        const trimmedLine = line.trim();

        // Empty lines don't affect indentation and are part of text content
        if (trimmedLine === '') {
            if (this.currentState === this.states.READING_TEXT) {
                this.textBuffer += '\n';
            }
            return;
        }

        // Comment lines start with #
        if (trimmedLine.startsWith('#') && this.currentState !== this.states.CHOICE_BLOCK) {
            return; // Ignore comments
        }

        // Command lines start with *
        if (trimmedLine.startsWith('*')) {
            // Flush any accumulated text before processing a command
            this.flushTextBuffer();
            this.currentState = this.states.COMMAND;

            // Process the command and determine if the next line needs indentation
            const { command } = parseCommand(trimmedLine, this.position);

            // Set expectation for next line indentation
            const commandsRequiringIndent = [
                'fake_choice', 'choice', 'if', 'else', 'elseif',
                'elsif', 'scene_list', 'achievement', 'goto_random_scene',
                'stat_chart'
            ];

            if (commandsRequiringIndent.includes(command)) {
                this.commandRequiringIndent = true;
                this.expectedIndentLevel = this.currentIndentLevel + 1;
            }

            this.processCommand(trimmedLine);
            return;
        }

        // Choice options start with # when inside a choice block
        if (trimmedLine.startsWith('#') && this.currentState === this.states.CHOICE_BLOCK) {
            // Options require next line to be indented
            this.commandRequiringIndent = true;
            this.expectedIndentLevel = this.currentIndentLevel + 1;

            this.processChoiceOption(trimmedLine);
            return;
        }

        // Handle scene list indented entries
        if (this.currentState === this.states.SCENE_LIST) {
            // Check if indentation level decreases, indicating end of scene list
            if (this.currentIndentLevel < this.expectedIndentLevel) {
                this.currentState = this.states.READING_TEXT;

                // Process this line as normal text
                if (this.textBuffer.length > 0) {
                    this.textBuffer += '\n';
                }
                this.textBuffer += trimmedLine;
                return;
            }

            // Must be properly indented to be part of scene list
            if (this.currentIndentLevel === this.expectedIndentLevel) {
                const sceneName = trimmedLine;

                // Add the scene to the node's scenes array
                const node = this.graph.nodes.get(this.currentNode!);
                if (node && node.type === 'scene_list') {
                    node.attributes.scenes.push(sceneName);
                }

                // Also add to the graph metadata
                if (!this.graph.metadata.sceneList.includes(sceneName)) {
                    this.graph.metadata.sceneList.push(sceneName);
                }
            } else {
                // If indentation doesn't match expected level, exit scene list
                this.currentState = this.states.READING_TEXT;

                // Process this line as normal text
                if (this.textBuffer.length > 0) {
                    this.textBuffer += '\n';
                }
                this.textBuffer += trimmedLine;
            }

            return;
        }

        // Handle indented content based on current state
        if (this.currentIndentLevel > 0) {
            if (this.currentState === this.states.CHOICE_BLOCK ||
                this.currentState === this.states.CONDITIONAL) {
                // Indented content in choice blocks or conditionals is processed differently
                this.processIndentedContent(line);
                return;
            }
        }

        // Handle random scene list indented entries
        if (this.currentState === this.states.RANDOM_SCENE_LIST) {
            // Check if indentation level decreases, indicating end of random scene list
            if (this.currentIndentLevel < this.expectedIndentLevel) {
                this.currentState = this.states.READING_TEXT;

                // Process this line as normal text
                this.processLine(line);
                return;
            }

            // Must be properly indented to be part of random scene list
            if (this.currentIndentLevel === this.expectedIndentLevel) {
                const sceneName = line.trim();

                // Add the scene to the node's scenes array
                const node = this.graph.nodes.get(this.currentNode!);
                if (node && node.type === 'goto_random_scene') {
                    node.attributes.scenes.push(sceneName);
                }
            } else {
                // If indentation doesn't match expected level, exit random scene list
                this.currentState = this.states.READING_TEXT;

                // Process this line as normal text
                this.processLine(line);
            }

            return;
        }

        // Handle stat chart indented entries
        if (this.currentState === this.states.STAT_CHART) {
            // Check if indentation level decreases, indicating end of stat chart
            if (this.currentIndentLevel < this.expectedIndentLevel) {
                this.currentState = this.states.READING_TEXT;

                // Process this line as normal text
                this.processLine(line);
                return;
            }

            // Must be properly indented to be part of stat chart
            if (this.currentIndentLevel === this.expectedIndentLevel) {
                const statLine = line.trim();

                // Parse the stat line (format: label %var description)
                const statMatch = statLine.match(/^([^%]+)\s+%(\w+)(?:\s+(.*))?$/);
                if (statMatch) {
                    const [_, label, variable, description] = statMatch;

                    // Add the stat to the node's stats array
                    const node = this.graph.nodes.get(this.currentNode!);
                    if (node && node.type === 'stat_chart') {
                        node.attributes.stats.push({
                            label: label.trim(),
                            variable: variable,
                            description: description ? description.trim() : ''
                        });
                    }
                } else {
                    console.warn(`Invalid stat chart entry at ${this.position.file}:${this.position.line}: ${statLine}`);
                }
            } else {
                // If indentation doesn't match expected level, exit stat chart
                this.currentState = this.states.READING_TEXT;

                // Process this line as normal text
                this.processLine(line);
            }
        }

        // Default: add line to text buffer
        if (this.currentState === this.states.READING_TEXT) {
            if (this.textBuffer.length > 0) {
                this.textBuffer += '\n';
            }
            this.textBuffer += trimmedLine;
        }
    }

    /**
     * Process a command line (starts with *)
     * @param line The command line to process
     */
    private processCommand(line: string): void {
        const { command, args } = parseCommand(line, this.position);
        
        switch (command) {
            case 'choice':
                this.startChoiceBlock(false);
                break;

            case 'fake_choice':
                this.startChoiceBlock(true);
                break;

            case 'if':
                this.startConditional(args);
                break;

            case 'elseif':
            case 'elsif':
                this.processElseIf(args);
                break;

            case 'else':
                this.processElse();
                break;

            case 'endif':
                this.endConditional();
                break;

            case 'goto':
            case 'goto_scene':
                this.processGoto(command, args);
                break;

            case 'label':
                this.processLabel(args);
                break;

            case 'create':
            case 'temp':
                this.processVariableDeclaration(command, args);
                break;

            case 'set':
                this.processVariableAssignment(args);
                break;

            case 'gosub':
            case 'gosub_scene':
                this.processGosub(command, args);
                break;

            case 'return':
                this.processReturn();
                break;

            case 'finish':
                this.processFinish(args);
                break;

            case 'page_break':
                this.processPageBreak(args);
                break;

            case 'title':
                this.processTitle(args);
                break;

            case 'author':
                this.processAuthor(args);
                break;

            case 'scene_list':
                this.processSceneList();
                break;

            case 'achievement':
                this.processAchievement(args);
                break;
            case 'comment:':    
            case 'comment':
                // Comments don't affect the graph structure
                const commentNodeId = this.createNode('comment', args || '');
                if (this.currentNode) {
                    this.addEdge(this.currentNode, commentNodeId);
                    this.currentNode = commentNodeId;
                }
                break;

            default:
                // Handle other commands or raise warning for unsupported commands
                console.warn(`Unsupported command at ${this.position.file}:${this.position.line}: ${command}`);

                // Create a generic command node for unsupported commands
                const cmdNodeId = this.createNode('unknown_command', `${command} ${args}`, {
                    command: command,
                    args: args
                });

                if (this.currentNode) {
                    this.addEdge(this.currentNode, cmdNodeId);
                    this.currentNode = cmdNodeId;
                }

                break;
        }
    }

    /**
     * Process the game title
     * @param title The game title
     */
    private processTitle(title: string): void {
        this.graph.metadata.title = title;

        const titleNodeId = this.createNode('metadata', `Title: ${title}`, {
            type: 'title',
            value: title
        });

        if (this.currentNode) {
            this.addEdge(this.currentNode, titleNodeId);
            this.currentNode = titleNodeId;
        }
    }

    /**
     * Process the game author
     * @param author The game author
     */
    private processAuthor(author: string): void {
        this.graph.metadata.author = author;

        const authorNodeId = this.createNode('metadata', `Author: ${author}`, {
            type: 'author',
            value: author
        });

        if (this.currentNode) {
            this.addEdge(this.currentNode, authorNodeId);
            this.currentNode = authorNodeId;
        }
    }

    /**
     * Process the scene list
     */
    private processSceneList(): void {
        this.flushTextBuffer();

        // Create a scene_list node
        const sceneListNodeId = this.createNode('scene_list', 'Scene List', {
            type: 'scene_list',
            scenes: []
        });

        if (this.currentNode) {
            this.addEdge(this.currentNode, sceneListNodeId);
            this.currentNode = sceneListNodeId;
        }

        // Switch to scene list state to collect scene names
        this.currentState = this.states.SCENE_LIST;

        // Next lines should be indented by 1 level
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * Process an achievement
     * @param args The achievement arguments
     */
    private processAchievement(args: string): void {
        // Extract achievement parts: id, visibility, points, name
        const match = RegExp(/^(\w+)\s+(visible|hidden)\s+(\d+)\s+(.+)$/).exec(args);

        if (match) {
            const [_, id, visibility, points, name] = match;

            // Create a new achievement
            this.currentAchievement = {
                id,
                name,
                visibility: visibility as 'visible' | 'hidden',
                points: parseInt(points, 10),
                description: '',
                earnedDescription: ''
            };

            this.inAchievementBlock = true;

            // Create an achievement node
            const achievementNodeId = this.createNode('achievement', `Achievement: ${name}`, {
                id,
                name,
                visibility,
                points
            });

            if (this.currentNode) {
                this.addEdge(this.currentNode, achievementNodeId);
                this.currentNode = achievementNodeId;
            }

            // Expect indentation for achievement descriptions
            this.commandRequiringIndent = true;
            this.expectedIndentLevel = this.currentIndentLevel + 1;
        } else {
            // End of achievement block
            if (this.inAchievementBlock && this.currentAchievement) {
                // Complete the achievement with descriptions from text buffer
                const lines = this.textBuffer.trim().split('\n');

                if (lines.length >= 2) {
                    this.currentAchievement.description = lines[0].trim();
                    this.currentAchievement.earnedDescription = lines[1].trim();

                    // Add to game metadata
                    this.graph.metadata.achievements.push(this.currentAchievement as Achievement);
                }

                this.inAchievementBlock = false;
                this.currentAchievement = null;
                this.textBuffer = '';
            } else {
                console.warn(`Invalid achievement syntax at ${this.position.file}:${this.position.line}: ${args}`);
            }
        }
    }

    /**
     * Process goto_random_scene command
     * @param args The command arguments
     */
    private processGotoRandomScene(args: string): void {
        this.flushTextBuffer();

        // Create a goto_random_scene node
        const randomSceneNodeId = this.createNode('goto_random_scene', `Goto Random Scene`, {
            scenes: []
        });

        if (this.currentNode) {
            this.addEdge(this.currentNode, randomSceneNodeId);
            this.currentNode = randomSceneNodeId;
        }

        // Switch to a state that collects scene names
        this.currentState = 'RANDOM_SCENE_LIST';

        // Next lines should be indented by 1 level
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }
    
    /**
     * Process stat_chart command
     * @param args The command arguments
     */
    private processStatChart(args: string): void {
        this.flushTextBuffer();

        // Create a stat_chart node
        const statChartNodeId = this.createNode('stat_chart', `Stat Chart: ${args || 'Stats'}`, {
            title: args || 'Stats',
            stats: []
        });

        if (this.currentNode) {
            this.addEdge(this.currentNode, statChartNodeId);
            this.currentNode = statChartNodeId;
        }

        // Switch to a state that collects stat entries
        this.currentState = 'STAT_CHART';

        // Next lines should be indented by 1 level
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * Start a choice block
     * @param isFake Whether this is a fake_choice
     */
    private startChoiceBlock(isFake: boolean): void {
        this.flushTextBuffer();
        this.currentState = this.states.CHOICE_BLOCK;

        // Create a choice node
        const choiceNodeId = this.createNode('choice', `Choice at ${this.position.file}:${this.position.line}`, {
            isFake: isFake
        });

        // Connect the current node to the choice node
        if (this.currentNode) {
            this.addEdge(this.currentNode, choiceNodeId);
        }

        // Set the choice node as the current node
        this.currentNode = choiceNodeId;
        
        this.choiceNodeStack.push(choiceNodeId);

        // Initialize array to track choice options
        this.graph.nodes.get(choiceNodeId).options = [];
        
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * Process a choice option (starts with #)
     * @param line The choice option line to process
     */
    private processChoiceOption(line: string): void {
        // Extract the option text
        const match = line.match(/^#(.*)$/);
        if (!match) {
            throw new Error(`Invalid choice option at ${this.position.file}:${this.position.line}: ${line}`);
        }

        const optionText = match[1].trim();

        // Extract conditional prefixes (*if or *selectable_if) and reuse modifiers
        const optionInfo = extractOptionPrefixes(optionText);
        let condition: string | null = optionInfo.condition;
        let optionTextClean = optionInfo.cleanText;
        let hideReuse = optionInfo.hideReuse;
        let disableReuse = optionInfo.disableReuse;
        let allowReuse = optionInfo.allowReuse;
        let isSelectable = optionInfo.isSelectable;

        // Create a node for this option with all the attributes
        const optionNodeId = this.createNode('option', optionTextClean, {
            hideReuse,
            disableReuse,
            allowReuse,
            isSelectable: isSelectable, // Add the selectable flag to the node attributes
            condition: condition       // Also store the condition directly in the node
        });

        if (this.choiceNodeStack.length === 0) {
            throw new Error(`No active choice block when processing choice option at ${this.position.file}:${this.position.line}`);
        }

        const currentChoiceNodeId = this.choiceNodeStack[this.choiceNodeStack.length - 1];
        
        const choiceNode = this.graph.nodes.get(currentChoiceNodeId);
        // Instead of using this.currentNode, we need to use the current choice node (parent)
        // We'll need to get it from the current choice context
        if (!choiceNode) {
            throw new Error(`No active choice block when processing choice option at ${this.position.file}:${this.position.line}`);
        }
        
        if (!choiceNode || !choiceNode.options) {
            throw new Error(`Invalid choice structure at ${this.position.file}:${this.position.line}`, this.textBuffer);
        }

        // Add this option to the choice node's options with the selectable flag
        choiceNode.options.push({
            id: optionNodeId,
            text: optionTextClean,
            conditions: condition ? [condition] : [],
            isSelectable: isSelectable  // Include the isSelectable flag in the ChoiceOption
        });

        // Add edge from choice to option with condition if applicable
        // For *selectable_if, we still create the edge with the condition
        // The condition will be checked at runtime to determine if the option should be selectable
        this.addEdge(choiceNode.id, optionNodeId, condition ? {
            condition,
            isSelectable: isSelectable  // Include the isSelectable flag in the edge attributes
        } : {});

        // Set current node to this option
        this.currentNode = optionNodeId;

        // Expect indentation for option content
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * Process indented content (used in choices and conditionals)
     * This method handles:
     * - Exiting blocks when indentation level decreases
     * - Processing indented content within choice options
     * - Processing indented content within conditional blocks
     * - Detecting and handling nested commands within indented content
     *
     * @param line The indented content line to process
     */
    private processIndentedContent(line: string): void {
        // Check if we're exiting the current block based on indentation
        if (this.currentIndentLevel < this.expectedIndentLevel) {
            // Calculate how many indentation levels we've decreased by
            const indentLevelDecrease = this.expectedIndentLevel - this.currentIndentLevel;

            // Handle exiting blocks based on the current state
            if (this.currentState === this.states.CHOICE_BLOCK) {
                // Pop from the choice stack based on how many levels we've decreased
                // This handles exiting multiple nested choice blocks at once
                for (let i = 0; i < indentLevelDecrease && this.choiceNodeStack.length > 0; i++) {
                    this.choiceNodeStack.pop();

                    // Log for debugging
                    console.debug(`Exited choice block, ${this.choiceNodeStack.length} levels remaining`);
                }

                // If we've exited all choice blocks, return to normal state
                if (this.choiceNodeStack.length === 0) {
                    this.currentState = this.states.READING_TEXT;
                    console.debug(`Exited all choice blocks, returning to ${this.states.READING_TEXT} state`);
                }

                // Update the expected indentation level to the current level
                this.expectedIndentLevel = this.currentIndentLevel;

                // Process this line as normal non-indented content
                this.processLine(line);
                return;
            } else if (this.currentState === this.states.CONDITIONAL) {
                // Handle exiting conditional blocks - should normally be handled by *endif
                // but we'll be forgiving and handle unexpected indentation changes
                console.warn(`Unexpected change in indentation level at ${this.position.file}:${this.position.line}. Expected *endif.`);

                // Close conditional blocks based on how many levels we've decreased
                for (let i = 0; i < indentLevelDecrease && this.conditionalStack.length > 0; i++) {
                    this.endConditional();
                    console.debug(`Force-closed conditional block due to indentation change`);
                }

                // Update the expected indentation level to the current level
                this.expectedIndentLevel = this.currentIndentLevel;

                // Process this line
                this.processLine(line);
                return;
            }
        }

        // Process indented content based on current state
        if (this.currentState === this.states.CHOICE_BLOCK) {
            // Indented content in choice blocks is text for the current option
            // This text will be accumulated until we encounter a command or leave the block
            const trimmedLine = line.trim();

            // Check if this is a nested command (including nested choices)
            if (trimmedLine.startsWith('*')) {
                // Flush any accumulated text before processing the command
                this.flushTextBuffer();

                // Process the command
                this.processCommand(trimmedLine);
            } else {
                // It's regular text content for the current option
                if (this.textBuffer.length > 0) {
                    this.textBuffer += '\n';
                }
                this.textBuffer += trimmedLine;
            }
        } else if (this.currentState === this.states.CONDITIONAL) {
            // Indented content in conditionals is processed as normal lines
            // This allows for full processing of commands within conditionals
            this.processLine(line.trim());
        } else if (this.currentState === this.states.SCENE_LIST ||
            this.currentState === this.states.RANDOM_SCENE_LIST ||
            this.currentState === this.states.STAT_CHART) {
            // For other states that use indentation, delegate to specific handlers
            // These states are handled in their respective processing methods
            // When indentation changes, the specific state handlers will detect it
            this.processLine(line);
        }
    }

    /**
     * Start a conditional block
     * @param condition The condition expression
     */
    private startConditional(condition: string): void {
        this.flushTextBuffer();

        // Push the current state onto the conditional stack
        this.conditionalStack.push({
            condition: condition,
            nodeBeforeIf: this.currentNode || '',
            branchEndNodes: []
        });

        this.currentState = this.states.CONDITIONAL;

        // Create a node for the conditional
        const condNodeId = this.createNode('conditional', `If: ${condition}`, {
            condition: condition
        });

        // Connect the current node to the conditional node
        if (this.currentNode) {
            this.addEdge(this.currentNode, condNodeId, { condition: condition });
        }

        // Set the conditional node as the current node
        this.currentNode = condNodeId;
        
        // Expect indentation for if block content
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * Process an else-if statement
     * @param condition The elseif condition expression
     */
    private processElseIf(condition: string): void {
        this.flushTextBuffer();

        if (this.conditionalStack.length === 0) {
            throw new Error(`*elseif without matching *if at ${this.position.file}:${this.position.line}`);
        }

        const ifState = this.conditionalStack[this.conditionalStack.length - 1];

        // Store the end of the previous branch
        if (this.currentNode) {
            ifState.branchEndNodes.push(this.currentNode);
        }

        // Create a node for the elseif
        const elseifNodeId = this.createNode('conditional', `ElseIf: ${condition}`, {
            condition: condition
        });

        // Connect the original node to this elseif, with the inverse of all previous conditions
        const negatedPrevious = `not(${ifState.condition})`;
        this.addEdge(ifState.nodeBeforeIf, elseifNodeId, { condition: `${negatedPrevious} and (${condition})` });

        // Update the state's condition to include this branch
        ifState.condition = `(${ifState.condition}) or (${condition})`;

        // Set the elseif node as the current node
        this.currentNode = elseifNodeId;
        
        // Expect indentation for elseif block content
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * Process an else statement
     */
    private processElse(): void {
        this.flushTextBuffer();

        if (this.conditionalStack.length === 0) {
            throw new Error(`*else without matching *if at ${this.position.file}:${this.position.line}`);
        }

        const ifState = this.conditionalStack[this.conditionalStack.length - 1];

        // Store the end of the previous branch
        if (this.currentNode) {
            ifState.branchEndNodes.push(this.currentNode);
        }

        // Create a node for the else
        const elseNodeId = this.createNode('conditional', 'Else', {
            condition: `not(${ifState.condition})`
        });

        // Connect the original node to this else, with the inverse of all previous conditions
        this.addEdge(ifState.nodeBeforeIf, elseNodeId, { condition: `not(${ifState.condition})` });

        // Set the else node as the current node
        this.currentNode = elseNodeId;
        
        // Expect indentation for else block content
        this.commandRequiringIndent = true;
        this.expectedIndentLevel = this.currentIndentLevel + 1;
    }

    /**
     * End a conditional block
     */
    private endConditional(): void {
        this.flushTextBuffer();

        if (this.conditionalStack.length === 0) {
            throw new Error(`*endif without matching *if at ${this.position.file}:${this.position.line}`);
        }

        const ifState = this.conditionalStack.pop()!;

        // Store the end of the last branch
        if (this.currentNode) {
            ifState.branchEndNodes.push(this.currentNode);
        }

        // Create a merge node for all branches to converge
        const mergeNodeId = this.createNode('merge', `End of conditional at ${this.position.file}:${this.position.line}`);

        // Connect all branch end nodes to the merge node
        ifState.branchEndNodes.forEach(endNode => {
            this.addEdge(endNode, mergeNodeId);
        });

        // Set the merge node as the current node
        this.currentNode = mergeNodeId;

        // If we're exiting the last conditional, switch back to READING_TEXT state
        if (this.conditionalStack.length === 0) {
            this.currentState = this.states.READING_TEXT;
        }
    }

    /**
     * Process goto command
     * @param command The goto command ('goto' or 'goto_scene')
     * @param target The target label or scene
     */
    private processGoto(command: string, target: string): void {
        this.flushTextBuffer();

        let sceneName: string | null = null;
        let labelName: string = target;

        // If this is a goto_scene, extract scene name and optional label
        if (command === 'goto_scene') {
            const parts = target.split(/\s+/);
            sceneName = parts[0];
            labelName = parts[1] || '';
        }

        // Create a goto node
        const gotoNodeId = this.createNode('goto', `Goto: ${target}`, {
            sceneName: sceneName,
            labelName: labelName
        });

        // Connect the current node to the goto node
        if (this.currentNode) {
            this.addEdge(this.currentNode, gotoNodeId);
        }

        // Set the goto node as the current node
        this.currentNode = gotoNodeId;

        // If we know where this goto leads, create an edge to that node
        if (sceneName) {
            const targetSceneEntry = this.graph.entryPoints.get(sceneName);
            if (targetSceneEntry) {
                this.addEdge(gotoNodeId, targetSceneEntry);
            }
        } else if (labelName) {
            const targetLabelNode = this.graph.labels.get(labelName);
            if (targetLabelNode) {
                this.addEdge(gotoNodeId, targetLabelNode);
            }
        }
    }

    /**
     * Process a label
     * @param label The label name
     */
    private processLabel(label: string): void {
        this.flushTextBuffer();

        // Create a label node
        const labelNodeId = this.createNode('label', `Label: ${label}`);

        // Connect the current node to the label node
        if (this.currentNode) {
            this.addEdge(this.currentNode, labelNodeId);
        }

        // Register this label in the graph's label map
        this.graph.labels.set(label, labelNodeId);

        // Set the label node as the current node
        this.currentNode = labelNodeId;
    }
    /**
     * Check if a string value is numeric
     * @param value The string to check
     * @returns true if the string represents a number
     */
    private isNumeric(value: string): boolean {
        // Handle empty string
        if (value === '') {
            return true;
        }

        // Check for valid number format
        const trimmedValue = value.trim();

        // Allow for negative numbers
        let startIndex = 0;
        if (trimmedValue[0] === '-' || trimmedValue[0] === '+') {
            startIndex = 1;
        }

        // Check that all remaining characters are digits or decimal point
        let hasDecimalPoint = false;
        for (let i = startIndex; i < trimmedValue.length; i++) {
            const char = trimmedValue[i];

            if (char === '.' && !hasDecimalPoint) {
                hasDecimalPoint = true;
                continue;
            }

            if (char < '0' || char > '9') {
                return false;
            }
        }

        return true;
    }
    /**
     * Process variable declaration
     * @param command The command ('create' or 'temp')
     * @param args The command arguments
     */
    private processVariableDeclaration(command: string, args: string): void {
        const result = this.extractVariableNameAndValue(args);

        if (!result) {
            throw new Error(`Invalid ${command} syntax at ${this.position.file}:${this.position.line}: ${args}`);
        }

        const { variableName, value: initialValue } = result;
        
        // Determine data type based on initial value
        let dataType = 'string';
        if (initialValue === 'true' || initialValue === 'false') {
            dataType = 'boolean';
        } else if (initialValue === '' || this.isNumeric(initialValue)) {
            dataType = 'numeric';
        }

        // Create variable object
        const variable: Variable = {
            name: variableName,
            type: command, // 'create' or 'temp'
            dataType,
            initialValue: initialValue
        };

        // Register the variable
        this.variables.set(variableName, variable);

        // For *create variables, also store in graph metadata
        if (command === 'create') {
            this.graph.metadata.variables.set(variableName, variable);
        }

        // Create a node for the variable declaration
        const varNodeId = this.createNode('variable', `${command} ${variableName} = ${initialValue}`, {
            command: command,
            variableName: variableName,
            initialValue: initialValue,
            dataType
        });

        // Connect the current node to the variable node
        if (this.currentNode) {
            this.addEdge(this.currentNode, varNodeId);
        }

        // Set the variable node as the current node
        this.currentNode = varNodeId;
    }

    /**
     * Extracts variable name and value from a command argument string
     * @param args The command arguments string
     * @returns An object with variable name, value, and operation type, or null if invalid
     */
    private extractVariableNameAndValue(args: string): {
        variableName: string;
        value: string;
        operation?: string;
    } | null {
        // Remove any leading/trailing whitespace
        const trimmedArgs = args.trim();

        if (trimmedArgs.length === 0) {
            console.error('Arguments empty');
            return null;
        }

        // Find the position of the first whitespace
        let firstSpaceIndex = -1;
        for (let i = 0; i < trimmedArgs.length; i++) {
            if (/\s/.test(trimmedArgs[i])) {
                firstSpaceIndex = i;
                break;
            }
        }
        
        // Check for fairmath operators (%+, %-)
        const fairMathPlusIndex = trimmedArgs.indexOf('%+');
        const fairMathMinusIndex = trimmedArgs.indexOf('%-');

        // Check for standard math operators (+, -)
        const plusIndex = trimmedArgs.indexOf('+');
        const minusIndex = trimmedArgs.indexOf('-');
        
        let rawVariableName: string = trimmedArgs;
        let value: string = '';
        let operation: string = 'set';

        if (fairMathPlusIndex !== -1) {
            // Format: name%+value
            const variableName = rawVariableName.substring(0, fairMathPlusIndex-1).trim();
            console.debug('Variable Name:', variableName)
            value = rawVariableName.substring(fairMathPlusIndex + 2).trim(); // +2 to skip the '%+'
            operation = 'fairmath_add';

            // Validate variable name
            if (!this.isValidVariableName(variableName) || value.length === 0) {
                console.error('Invalid variable name, or unset value in fairmath_add', variableName, value);
                return null;
            }

            return { variableName, value, operation };
        }
        
        if (fairMathMinusIndex !== -1) {
            // Format: name%-value
            const variableName = rawVariableName.substring(0, fairMathMinusIndex).trim();
            value = rawVariableName.substring(fairMathMinusIndex + 2).trim(); // +2 to skip the '%-'
            operation = 'fairmath_subtract';

            // Validate variable name
            if (!this.isValidVariableName(variableName) || value.length === 0) {
                console.error('Invalid variable name, or unset value in fairmath_subtract', variableName, value);
                return null;
            }

            return { variableName, value, operation };
        }

        if (plusIndex !== -1) {
            // Format: name+value
            const variableName = rawVariableName.substring(0, plusIndex);
            value = rawVariableName.substring(plusIndex + 1); // +1 to skip the '+'
            operation = 'add';

            // Validate variable name
            if (!this.isValidVariableName(variableName) || value.length === 0) {
                console.error('Invalid variable name, or unset value in plus', variableName, value);
                return null;
            }

            return { variableName, value, operation };
        } else if (minusIndex !== -1) {
            // Format: name-value
            const variableName = rawVariableName.substring(0, minusIndex);
            value = rawVariableName.substring(minusIndex + 1); // +1 to skip the '-'
            operation = 'subtract';

            // Validate variable name
            if (!this.isValidVariableName(variableName) || value.length === 0) {
                console.error('Invalid variable name, or unset value in subtract', variableName, value);
                return null;
            }

            return { variableName, value, operation };
        }
        
        if (firstSpaceIndex === -1) {
            // If we get here, no operators were found, so it's just a variable name
            // This could be valid for *set commands when setting a variable to true
            if (this.isValidVariableName(rawVariableName)) {
                return { variableName: rawVariableName, value: '' };
            }

            console.error('No variable value set for', rawVariableName);
            return null;
        }

        // Extract variable name (before the space)
        rawVariableName = trimmedArgs.substring(0, firstSpaceIndex);

        // Validate variable name
        if (!this.isValidVariableName(rawVariableName)) {
            console.error('Invalid variable name', rawVariableName);
            return null;
        }

        // Extract value (after the space)
        value = trimmedArgs.substring(firstSpaceIndex).trim();

        // Check for operation prefixes in the value
        if (value.startsWith('%+')) {
            operation = 'fairmath_add';
            value = value.substring(2).trim();
        } else if (value.startsWith('%-')) {
            operation = 'fairmath_subtract';
            value = value.substring(2).trim();
        } else if (value.startsWith('+')) {
            operation = 'add';
            value = value.substring(1).trim();
        } else if (value.startsWith('-')) {
            operation = 'subtract';
            value = value.substring(1).trim();
        }

        return { variableName: rawVariableName, value, operation };
    }

    /**
     * Validates that a variable name contains only valid characters (alphanumeric + underscore)
     * @param name The variable name to validate
     * @returns true if the name is valid, false otherwise
     */
    private isValidVariableName(name: string): boolean {
        if (name.length === 0) {
            return false;
        }

        for (let i = 0; i < name.length; i++) {
            const char = name.charAt(i);
            const isValid =
                (char >= 'a' && char <= 'z') ||
                (char >= 'A' && char <= 'Z') ||
                (char >= '0' && char <= '9') ||
                char === '_';

            if (!isValid) {
                return false;
            }
        }

        return true;
    }
    
    /**
     * Process variable assignment
     * @param args The command arguments
     */
    private processVariableAssignment(args: string): void {
        // Extract variable name and value
        const result = this.extractVariableNameAndValue(args);

        if (!result) {
            throw new Error(`Invalid set syntax at ${this.position.file}:${this.position.line}: ${args}`);
        }

        const { variableName, value, operation = 'set' } = result;

        // Create a node for the variable assignment
        const setNodeId = this.createNode('set', `set ${variableName} = ${value}`, {
            variableName: variableName,
            value: value,
            operation: operation,
            isFairmath: operation === 'fairmath_add' || operation === 'fairmath_subtract'
        });

        // Connect the current node to the set node
        if (this.currentNode) {
            this.addEdge(this.currentNode, setNodeId, {
                statChanges: [{
                    variable: variableName,
                    operation: value.includes('%+') ? 'fairmath_add' :
                        value.includes('%-') ? 'fairmath_subtract' : 'set',
                    value: value.replace(/^[%+\-]*/, '')
                }]
            });
        }

        // Set the set node as the current node
        this.currentNode = setNodeId;
    }

    /**
     * Process gosub command
     * @param command The command ('gosub' or 'gosub_scene')
     * @param target The target label or scene
     */
    private processGosub(command: string, target: string): void {
        this.flushTextBuffer();

        let sceneName: string | null = null;
        let labelName: string = target;

        // If this is a gosub_scene, extract scene name and label
        if (command === 'gosub_scene') {
            const parts = target.split(/\s+/);
            sceneName = parts[0];
            labelName = parts[1] || '';
        }

        // Create a gosub node
        const gosubNodeId = this.createNode('gosub', `${command}: ${target}`, {
            sceneName: sceneName,
            labelName: labelName
        });

        // Connect the current node to the gosub node
        if (this.currentNode) {
            this.addEdge(this.currentNode, gosubNodeId);

            // Push the current node to the subroutine stack
            this.subroutineStack.push(this.currentNode);
        }

        // Set the gosub node as the current node
        this.currentNode = gosubNodeId;

        // Change the state to SUBROUTINE
        this.currentState = this.states.SUBROUTINE;

        // If we know where this gosub leads, create an edge to that node
        if (sceneName) {
            const targetSceneEntry = this.graph.entryPoints.get(sceneName);
            if (targetSceneEntry) {
                this.addEdge(gosubNodeId, targetSceneEntry);
            }
        } else if (labelName) {
            const targetLabelNode = this.graph.labels.get(labelName);
            if (targetLabelNode) {
                this.addEdge(gosubNodeId, targetLabelNode);
            }
        }
    }

    /**
     * Process return from subroutine
     */
    private processReturn(): void {
        this.flushTextBuffer();

        if (this.subroutineStack.length === 0) {
            throw new Error(`*return without matching *gosub at ${this.position.file}:${this.position.line}`);
        }

        // Create a return node
        const returnNodeId = this.createNode('return', `Return at ${this.position.file}:${this.position.line}`);

        // Connect the current node to the return node
        if (this.currentNode) {
            this.addEdge(this.currentNode, returnNodeId);
        }

        // Pop the return target from the subroutine stack
        const returnTarget = this.subroutineStack.pop()!;

        // Connect the return node to the return target
        this.addEdge(returnNodeId, returnTarget);

        // Set the return node as the current node
        this.currentNode = returnNodeId;

        // Change state back to READING_TEXT if no more subroutines
        if (this.subroutineStack.length === 0) {
            this.currentState = this.states.READING_TEXT;
        }
    }

    /**
     * Process finish command
     * @param args The command arguments (button text)
     */
    private processFinish(args: string): void {
        this.flushTextBuffer();

        // Create a finish node
        const finishNodeId = this.createNode('finish', `Finish: ${args || 'End of game'}`, {
            buttonText: args
        });

        // Connect the current node to the finish node
        if (this.currentNode) {
            this.addEdge(this.currentNode, finishNodeId);
        }

        // Set the finish node as the current node
        this.currentNode = finishNodeId;
    }

    /**
     * Process page_break command
     * @param args The command arguments (button text)
     */
    private processPageBreak(args: string): void {
        this.flushTextBuffer();

        // Create a page_break node
        const pageBreakNodeId = this.createNode('page_break', `Page break: ${args || 'Next'}`, {
            buttonText: args
        });

        // Connect the current node to the page_break node
        if (this.currentNode) {
            this.addEdge(this.currentNode, pageBreakNodeId);
        }

        // Create a continuation node
        const continueNodeId = this.createNode('text', `After page break at ${this.position.file}:${this.position.line}`);

        // Connect the page_break node to the continuation node
        this.addEdge(pageBreakNodeId, continueNodeId);

        // Set the continuation node as the current node
        this.currentNode = continueNodeId;
    }

    /**
     * Create a new node in the graph
     * @param type The node type
     * @param text The node text description
     * @param attributes Additional node attributes
     * @returns The ID of the created node
     */
    private createNode(type: string, text: string, attributes: Record<string, any> = {}): string {
        const nodeId = `node_${++this.nodeIdCounter}`;
        
        console.debug('Created node', type, nodeId, this.position);
        this.graph.nodes.set(nodeId, {
            id: nodeId,
            type: type,
            text: text,
            attributes: attributes,
            position: { ...this.position } // Copy current position
        });

        return nodeId;
    }

    /**
     * Add an edge to the graph
     * @param sourceId The source node ID
     * @param targetId The target node ID
     * @param attributes Additional edge attributes
     */
    private addEdge(sourceId: string, targetId: string, attributes: Record<string, any> = {}): void {
        this.graph.edges.push({
            source: sourceId,
            target: targetId,
            attributes: attributes,
            position: { ...this.position } // Copy current position
        });
    }

    /**
     * Flush text buffer to create a text node
     */
    private flushTextBuffer(): void {
        if (this.textBuffer.trim().length > 0) {
            // Create a text node
            const textNodeId = this.createNode('text', this.textBuffer);

            // Connect the current node to the text node
            if (this.currentNode) {
                this.addEdge(this.currentNode, textNodeId);
            }

            // Set the text node as the current node
            this.currentNode = textNodeId;
        }

        // Clear the text buffer
        this.textBuffer = '';
    }

    /**
     * Reset the state machine to initial state
     */
    private resetState(): void {
        this.currentState = this.states.READING_TEXT;
        this.position = { file: '', line: 0 };
        this.currentNode = null;
        this.choiceNodeStack = [];
        this.textBuffer = '';
        this.conditionalStack = [];
        this.executionMode = 'normal';
        this.subroutineStack = [];

        // Reset indentation tracking
        this.currentIndentLevel = 0;
        this.expectedIndentLevel = 0;
        this.indentSize = null;
        this.lastIndentationType = null;
        this.commandRequiringIndent = false;
        
        // Keep variables but reset graph
        this.graph = {
            nodes: new Map(),
            edges: [],
            entryPoints: new Map(),
            labels: new Map(),
            metadata: {
                variables: new Map(),
                title: undefined,
                author: undefined,
                sceneList: [],
                achievements: [],
            }
        };

        this.nodeIdCounter = 0;
        this.processedScenes = new Set();
    }
}