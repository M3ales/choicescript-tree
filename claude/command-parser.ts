// command-parser.ts - Utility for parsing ChoiceScript commands

import { Position } from './types';

/**
 * ParsedCommand - Result of parsing a ChoiceScript command line
 */
export interface ParsedCommand {
    command: string;
    args: string;
}

/**
 * Parse a ChoiceScript command line without using regular expressions
 * @param line The command line to parse (starts with *)
 * @param position Current position in the file (for error reporting)
 * @returns Parsed command and arguments
 * @throws Error if the command syntax is invalid
 */
export function parseCommand(line: string, position: Position): ParsedCommand {
    // Initialize command and args variables
    let command: string;
    let args: string = '';

    // Remove the leading asterisk
    if (!line.startsWith('*')) {
        throw new Error(`Invalid command syntax at ${position.file}:${position.line}: ${line}`);
    }

    // Get the string after the asterisk
    const commandLine = line.substring(1);

    // Find the first whitespace to separate command from arguments
    const firstSpaceIndex = commandLine.search(/\s/);

    if (firstSpaceIndex === -1) {
        // No space found, the entire string is the command
        command = commandLine;
    } else {
        // Extract command (before the space)
        command = commandLine.substring(0, firstSpaceIndex);

        // Extract args (after the space)
        args = commandLine.substring(firstSpaceIndex).trim();
    }

    // Validate command is a word (contains only alphanumeric chars and underscore)
    for (let i = 0; i < command.length; i++) {
        const char = command.charAt(i);
        const isValid =
            (char >= 'a' && char <= 'z') ||
            (char >= 'A' && char <= 'Z') ||
            (char >= '0' && char <= '9') ||
            char === '_' || char === ':';

        if (!isValid) {
            throw new Error(`Invalid command syntax at ${position.file}:${position.line}: ${line}`);
        }
    }

    return { command, args };
}