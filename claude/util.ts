// utils.ts - Utility functions for working with ChoiceScript graphs

import { Graph, Node, Edge } from './types';

/**
 * Export graph to JSON format
 * @param graph The graph to export
 * @returns A JSON string representing the graph
 */
export function exportGraphToJSON(graph: Graph): string {
    // Convert Map objects to regular objects for JSON serialization
    const serializable = {
        nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({
            id,
            ...node
        })),
        edges: graph.edges,
        entryPoints: Array.from(graph.entryPoints.entries()).map(([scene, nodeId]) => ({
            scene,
            nodeId
        })),
        labels: Array.from(graph.labels.entries()).map(([label, nodeId]) => ({
            label,
            nodeId
        }))
    };

    return JSON.stringify(serializable, null, 2);
}

/**
 * Export graph to DOT format for visualization with Graphviz
 * @param graph The graph to export
 * @returns A DOT format string
 */
export function exportGraphToDOT(graph: Graph): string {
    let dot = 'digraph ChoiceScript {\n';

    // Add nodes
    for (const [id, node] of graph.nodes.entries()) {
        const label = `${node.type}: ${truncateText(node.text, 30)}`;
        dot += `  "${id}" [label="${escapeText(label)}", shape="${getNodeShape(node.type)}"];\n`;
    }

    // Add edges
    for (const edge of graph.edges) {
        let label = '';
        if (edge.attributes.condition) {
            label = ` [label="${escapeText('if ' + edge.attributes.condition)}"]`;
        } else if (edge.attributes.statChanges) {
            const changes = edge.attributes.statChanges.map((c: any) =>
                `${c.variable} ${c.operation} ${c.value}`
            ).join(', ');
            label = ` [label="${escapeText(changes)}"]`;
        }

        dot += `  "${edge.source}" -> "${edge.target}"${label};\n`;
    }

    // Highlight entry points with a different color
    dot += '\n  // Entry points\n';
    for (const [scene, nodeId] of graph.entryPoints.entries()) {
        dot += `  "${nodeId}" [style=filled, fillcolor=lightblue, label="Entry: ${escapeText(scene)}"];\n`;
    }

    // Highlight terminal nodes
    dot += '\n  // Terminal nodes\n';
    for (const [id, node] of graph.nodes.entries()) {
        if (node.type === 'finish') {
            dot += `  "${id}" [style=filled, fillcolor=lightcoral];\n`;
        }
    }

    dot += '}\n';
    return dot;
}

/**
 * Get the appropriate shape for a node type in DOT format
 * @param type The node type
 * @returns A DOT shape name
 */
function getNodeShape(type: string): string {
    switch (type) {
        case 'scene_entry': return 'doublecircle';
        case 'choice': return 'diamond';
        case 'option': return 'box';
        case 'text': return 'ellipse';
        case 'conditional': return 'hexagon';
        case 'merge': return 'invtriangle';
        case 'goto': return 'invtrapezium';
        case 'gosub': return 'invhouse';
        case 'return': return 'house';
        case 'finish': return 'doubleoctagon';
        case 'page_break': return 'octagon';
        case 'variable':
        case 'set': return 'septagon';
        case 'label': return 'tripleoctagon';
        case 'metadata': return 'note';
        default: return 'box';
    }
}

/**
 * Escape text for DOT format
 * @param text The text to escape
 * @returns The escaped text
 */
function escapeText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
}

/**
 * Truncate text to a maximum length
 * @param text The text to truncate
 * @param maxLength The maximum length
 * @returns The truncated text
 */
function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength) + '...';
}

/**
 * Find all paths between two nodes in the graph
 * @param graph The graph to search
 * @param startNodeId The starting node ID
 * @param endNodeId The ending node ID
 * @returns Array of paths, where each path is an array of node IDs
 */
export function findAllPaths(
    graph: Graph,
    startNodeId: string,
    endNodeId: string
): string[][] {
    const visited = new Set<string>();
    const paths: string[][] = [];

    function dfs(currentId: string, path: string[]) {
        // Add current node to path
        path.push(currentId);

        // If we reached the target, save this path
        if (currentId === endNodeId) {
            paths.push([...path]);
            path.pop(); // Remove from current path
            return;
        }

        // Mark as visited
        visited.add(currentId);

        // Find all outgoing edges from this node
        for (const edge of graph.edges) {
            if (edge.source === currentId && !visited.has(edge.target)) {
                dfs(edge.target, path);
            }
        }

        // Backtrack
        visited.delete(currentId);
        path.pop();
    }

    dfs(startNodeId, []);
    return paths;
}

/**
 * Detect cycles in the graph
 * @param graph The graph to check
 * @returns Array of cycles, where each cycle is an array of node IDs
 */
export function detectCycles(graph: Graph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function dfs(nodeId: string, path: string[]) {
        // If node is already in recursion stack, we found a cycle
        if (recStack.has(nodeId)) {
            // Extract the cycle from the path
            const cycleStart = path.findIndex(id => id === nodeId);
            cycles.push(path.slice(cycleStart).concat(nodeId));
            return;
        }

        // If already visited in another path, no need to explore again
        if (visited.has(nodeId)) {
            return;
        }

        // Add to visited and recursion stack
        visited.add(nodeId);
        recStack.add(nodeId);
        path.push(nodeId);

        // Explore all outgoing edges
        for (const edge of graph.edges) {
            if (edge.source === nodeId) {
                dfs(edge.target, [...path]);
            }
        }

        // Remove from recursion stack when done with this node
        recStack.delete(nodeId);
    }

    // Start DFS from each node to find all cycles
    for (const nodeId of graph.nodes.keys()) {
        dfs(nodeId, []);
    }

    return cycles;
}

/**
 * Find unreachable nodes in the graph
 * @param graph The graph to check
 * @returns Array of unreachable node IDs
 */
export function findUnreachableNodes(graph: Graph): string[] {
    const visited = new Set<string>();

    // Start from all entry points
    const entryPoints = Array.from(graph.entryPoints.values());

    function dfs(nodeId: string) {
        if (visited.has(nodeId)) {
            return;
        }

        visited.add(nodeId);

        // Visit all connected nodes
        for (const edge of graph.edges) {
            if (edge.source === nodeId) {
                dfs(edge.target);
            }
        }
    }

    // Visit all nodes reachable from entry points
    for (const entryPoint of entryPoints) {
        dfs(entryPoint);
    }

    // Find nodes that weren't visited
    const unreachable: string[] = [];
    for (const nodeId of graph.nodes.keys()) {
        if (!visited.has(nodeId)) {
            unreachable.push(nodeId);
        }
    }

    return unreachable;
}

/**
 * Extract all variables used in the graph
 * @param graph The graph to analyze
 * @returns Map of variable names to their metadata
 */
export function extractVariables(graph: Graph): Map<string, {
    declarations: string[],
    usages: string[],
    assignments: string[]
}> {
    const variables = new Map<string, {
        declarations: string[],
        usages: string[],
        assignments: string[]
    }>();

    // Scan all nodes for variable declarations and assignments
    for (const [nodeId, node] of graph.nodes.entries()) {
        if (node.type === 'variable') {
            const varName = node.attributes.variableName;
            if (!variables.has(varName)) {
                variables.set(varName, {
                    declarations: [],
                    usages: [],
                    assignments: []
                });
            }
            variables.get(varName)!.declarations.push(nodeId);
        } else if (node.type === 'set') {
            const varName = node.attributes.variableName;
            if (!variables.has(varName)) {
                variables.set(varName, {
                    declarations: [],
                    usages: [],
                    assignments: []
                });
            }
            variables.get(varName)!.assignments.push(nodeId);
        }
    }

    // Scan all edges for variable usages in conditions
    for (const edge of graph.edges) {
        if (edge.attributes.condition) {
            const condition = edge.attributes.condition;

            // Extract variable names from condition using regex
            // This is a simplistic approach and might miss complex cases
            const varMatches = condition.match(/\b[a-zA-Z_]\w*\b/g) || [];

            for (const varName of varMatches) {
                // Skip common keywords
                if (['and', 'or', 'not', 'true', 'false'].includes(varName)) {
                    continue;
                }

                if (!variables.has(varName)) {
                    variables.set(varName, {
                        declarations: [],
                        usages: [],
                        assignments: []
                    });
                }

                if (!variables.get(varName)!.usages.includes(edge.source)) {
                    variables.get(varName)!.usages.push(edge.source);
                }
            }
        }
    }

    return variables;
}

/**
 * Validate the graph for common errors
 * @param graph The graph to validate
 * @returns Object containing validation results
 */
export function validateGraph(graph: Graph): {
    errors: string[],
    warnings: string[]
} {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for unreachable nodes
    const unreachable = findUnreachableNodes(graph);
    if (unreachable.length > 0) {
        warnings.push(`Found ${unreachable.length} unreachable nodes: ${unreachable.slice(0, 5).join(', ')}${unreachable.length > 5 ? '...' : ''}`);
    }

    // Check for cycles
    const cycles = detectCycles(graph);
    if (cycles.length > 0) {
        warnings.push(`Found ${cycles.length} cycles in the graph`);
    }

    // Check for variables used before declaration
    const variables = extractVariables(graph);
    for (const [varName, varInfo] of variables.entries()) {
        if (varInfo.declarations.length === 0 && (varInfo.usages.length > 0 || varInfo.assignments.length > 0)) {
            warnings.push(`Variable '${varName}' is used before declaration`);
        }
    }

    // Check for nodes with no outgoing edges (dead ends)
    const deadEnds: string[] = [];
    for (const [nodeId, node] of graph.nodes.entries()) {
        if (node.type !== 'finish' && node.type !== 'goto' && node.type !== 'gosub') {
            const hasOutgoing = graph.edges.some(edge => edge.source === nodeId);
            if (!hasOutgoing) {
                deadEnds.push(nodeId);
            }
        }
    }

    if (deadEnds.length > 0) {
        warnings.push(`Found ${deadEnds.length} nodes with no outgoing edges (excluding finish nodes)`);
    }

    return { errors, warnings };
}