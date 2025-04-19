import { ChoiceScriptStateMachine } from "./statemachine";
import { HttpSceneProvider } from "./scene-providers";
import * as fs from "node:fs";

// Configuration
const url = 'https://www.choiceofgames.com/user-contributed/fallen-hero-rebirth/scenes/';
const outputFormat: string = 'dot'; // Can be 'markdown', 'json', or 'dot'

/**
 * Main function to process the game and generate choice graph visualization
 */
async function generateChoiceGraph() {
    console.log(`Generating choice graph for ${url}`);

    // Create scene provider and state machine
    const sceneProvider = new HttpSceneProvider(url);
    const stateMachine = new ChoiceScriptStateMachine(sceneProvider);

    try {
        // Process the game starting from 'startup'
        console.log("Processing game...");
        const graph = await stateMachine.processGame('startup');
        console.log(`Game processed. Found ${graph.nodes.size} nodes and ${graph.edges.length} edges.`);

        // Extract and format choice graph data
        const choicesData = extractChoicesAndStatChanges(graph);

        // Output in the requested format
        let output;
        if (outputFormat === 'json') {
            output = JSON.stringify(choicesData, null, 2);
        } else if (outputFormat === 'dot') {
            output = generateDotGraph(choicesData);
        } else {
            output = formatChoicesAndStatChanges(choicesData);
        }

        console.log("Choice graph generated successfully!");
        return output;

    } catch (error) {
        console.error("Error generating choice graph:", error);
        return `Error: ${error.message}`;
    }
}

/**
 * Extract all choices and their associated stat changes from the graph
 */
function extractChoicesAndStatChanges(graph) {
    const result = {
        metadata: {
            title: graph.metadata.title || "Unknown Game",
            author: graph.metadata.author || "Unknown Author",
            sceneCount: graph.metadata.sceneList.length
        },
        choices: []
    };

    // Map to track nodes we've already visited to avoid cycles
    const visited = new Set();

    // Find all choice nodes
    for (const [nodeId, node] of graph.nodes.entries()) {
        if (node.type === 'choice' && node.options) {
            const choiceInfo = {
                id: nodeId,
                text: node.text,
                location: `${node.position.file}:${node.position.line}`,
                isFake: node.attributes.isFake || false,
                options: []
            };

            // For each option in this choice, trace the path to find stat changes
            if (node.options) {
                node.options.forEach(option => {
                    // Get the option node details
                    const optionNode = graph.nodes.get(option.id);
                    if (!optionNode) return;

                    const optionInfo = {
                        id: option.id,
                        text: option.text,
                        conditions: option.conditions || [],
                        hideReuse: optionNode.attributes?.hideReuse || false,
                        disableReuse: optionNode.attributes?.disableReuse || false,
                        statChanges: [],
                        nextChoices: []
                    };

                    // Reset visited set for each option's path tracing
                    visited.clear();

                    // Find stat changes and next choices along this option's path
                    traceOptionPath(graph, option.id, optionInfo, visited);

                    choiceInfo.options.push(optionInfo);
                });
            }

            result.choices.push(choiceInfo);
        }
    }

    return result;
}

/**
 * Recursively trace the path from an option to find stat changes and next choices
 */
function traceOptionPath(graph, nodeId, optionInfo, visited) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    // Find all outgoing edges from this node
    for (const edge of graph.edges) {
        if (edge.source === nodeId) {
            const targetNode = graph.nodes.get(edge.target);
            if (!targetNode) continue;

            // Check if this edge has stat changes
            if (edge.attributes.statChanges) {
                edge.attributes.statChanges.forEach(change => {
                    optionInfo.statChanges.push(change);
                });
            }

            // Check if the target node is a variable assignment (set)
            if (targetNode.type === 'set') {
                // Add stat change if not already recorded from edge
                const statChange = {
                    variable: targetNode.attributes.variableName,
                    operation: targetNode.attributes.operation,
                    value: targetNode.attributes.value
                };

                // Check if we already have this exact stat change
                const hasChange = optionInfo.statChanges.some(change =>
                    change.variable === statChange.variable &&
                    change.operation === statChange.operation &&
                    change.value === statChange.value
                );

                if (!hasChange) {
                    optionInfo.statChanges.push(statChange);
                }
            }

            // Check if the target node is another choice
            if (targetNode.type === 'choice') {
                optionInfo.nextChoices.push({
                    id: targetNode.id,
                    text: targetNode.text
                });
            }

            // Continue tracing until we hit a choice or a terminal node
            if (targetNode.type !== 'choice' && targetNode.type !== 'finish') {
                traceOptionPath(graph, edge.target, optionInfo, visited);
            }
        }
    }
}

/**
 * Format the choices data as a readable markdown document
 */
function formatChoicesAndStatChanges(choicesData) {
    let output = `# ${choicesData.metadata.title}\n\n`;
    output += `By ${choicesData.metadata.author}\n\n`;
    output += `Contains ${choicesData.choices.length} choices across ${choicesData.metadata.sceneCount} scenes.\n\n`;
    output += `## Choice Graph\n\n`;

    choicesData.choices.forEach((choice, choiceIndex) => {
        output += `### ${choiceIndex + 1}. ${choice.text}\n`;
        output += `Location: ${choice.location}\n`;

        if (choice.isFake) {
            output += `*(This is a fake choice - all options lead to the same outcome)*\n`;
        }

        output += `\n`;

        choice.options.forEach((option, optionIndex) => {
            output += `#### Option ${optionIndex + 1}: "${option.text}"\n`;

            if (option.conditions && option.conditions.length > 0) {
                output += `**Requirements:** ${option.conditions.join(', ')}\n\n`;
            }

            if (option.hideReuse) {
                output += `*This option will be hidden after selection*\n\n`;
            } else if (option.disableReuse) {
                output += `*This option will be disabled after selection*\n\n`;
            }

            if (option.statChanges.length > 0) {
                output += "**Stat Changes:**\n";
                option.statChanges.forEach(change => {
                    const operationSymbol = getOperationSymbol(change.operation);
                    output += `- ${change.variable} ${operationSymbol} ${change.value}\n`;
                });
                output += "\n";
            }

            if (option.nextChoices.length > 0) {
                output += "**Leads to:**\n";
                option.nextChoices.forEach(nextChoice => {
                    output += `- ${nextChoice.text}\n`;
                });
                output += "\n";
            }
        });

        output += `---\n\n`;
    });

    return output;
}

/**
 * Generate a DOT graph format for visualization with Graphviz
 */
function generateDotGraph(choicesData) {
    let dot = 'digraph ChoiceGraph {\n';
    dot += '  // Graph settings\n';
    dot += '  graph [fontname="Arial", rankdir=LR];\n';
    dot += '  node [fontname="Arial", shape=box, style=filled, fillcolor=lightblue];\n';
    dot += '  edge [fontname="Arial"];\n\n';

    // Add title
    dot += `  // Title: ${choicesData.metadata.title}\n`;
    dot += `  // Author: ${choicesData.metadata.author}\n\n`;

    // Add nodes for each choice
    dot += '  // Choice nodes\n';
    choicesData.choices.forEach(choice => {
        const label = `"${choice.text.substring(0, 30)}${choice.text.length > 30 ? '...' : ''}"`;
        const shape = choice.isFake ? 'ellipse' : 'diamond';
        dot += `  "${choice.id}" [label=${label}, shape=${shape}];\n`;

        // Add nodes for each option
        choice.options.forEach(option => {
            const optLabel = `"${option.text.substring(0, 25)}${option.text.length > 25 ? '...' : ''}"`;
            const optColor = option.conditions.length > 0 ? 'lightpink' : 'lightgreen';
            dot += `  "${option.id}" [label=${optLabel}, fillcolor=${optColor}];\n`;

            // Add edge from choice to option
            let edgeLabel = '';
            if (option.conditions.length > 0) {
                edgeLabel = ` [label="${option.conditions.join(', ').replaceAll('"',"")}"]`;
            }
            dot += `  "${choice.id}" -> "${option.id}"${edgeLabel};\n`;

            // Add edges to next choices
            option.nextChoices.forEach(nextChoice => {
                // Add stat changes as edge labels
                let statChanges = '';
                if (option.statChanges.length > 0) {
                    statChanges = option.statChanges.map(change =>
                        `${change.variable} ${getOperationSymbol(change.operation)} ${change.value.replaceAll('"', "'")}`
                    ).join(', ');
                }

                const nextEdgeLabel = statChanges ? ` [label="${statChanges}"]` : '';
                dot += `  "${option.id}" -> "${nextChoice.id}"${nextEdgeLabel};\n`;
            });
        });
    });

    dot += '}\n';
    return dot;
}

/**
 * Helper to get a readable operator symbol
 */
function getOperationSymbol(operation) {
    switch (operation) {
        case 'set': return '=';
        case 'add': return '+';
        case 'subtract': return '-';
        case 'fairmath_add': return '%+';
        case 'fairmath_subtract': return '%-';
        default: return operation;
    }
}

// Execute the main function when file is run
generateChoiceGraph().then(output => {
    fs.writeFileSync('output.dot', output, { encoding: 'utf8', flush: true });
});