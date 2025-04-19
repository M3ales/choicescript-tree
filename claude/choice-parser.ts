/**
 * Extract option prefixes and modifiers from a choice option text
 * @param optionText The option text to process
 * @returns Object containing all extracted information
 */
export const extractOptionPrefixes = (optionText: string): {
    cleanText: string;
    condition: string | null;
    hideReuse: boolean;
    disableReuse: boolean;
    allowReuse: boolean;
    isSelectable: boolean;
} => {
    let result = {
        cleanText: optionText,
        condition: null as string | null,
        hideReuse: false,
        disableReuse: false,
        allowReuse: false,
        isSelectable: false
    };

    // Check for *hide_reuse
    if (result.cleanText.startsWith('*hide_reuse ')) {
        result.hideReuse = true;
        result.cleanText = result.cleanText.substring('*hide_reuse '.length);
    }

    // Check for *disable_reuse
    if (result.cleanText.startsWith('*disable_reuse ')) {
        result.disableReuse = true;
        result.cleanText = result.cleanText.substring('*disable_reuse '.length);
    }

    // Check for *allow_reuse
    if (result.cleanText.startsWith('*allow_reuse ')) {
        result.allowReuse = true;
        result.cleanText = result.cleanText.substring('*allow_reuse '.length);
    }

    // Now check for conditional prefixes
    // First check for *selectable_if (we check this first to avoid matching the "if" part with *if)
    if (result.cleanText.startsWith('*selectable_if (')) {
        const openParenIndex = result.cleanText.indexOf('(');
        const closeParenIndex = findMatchingClosingParenthesis(result.cleanText, openParenIndex);

        if (closeParenIndex > openParenIndex && closeParenIndex < result.cleanText.length) {
            result.condition = result.cleanText.substring(openParenIndex + 1, closeParenIndex);
            const afterParen = result.cleanText.substring(closeParenIndex + 1).trim();
            result.cleanText = afterParen;
            result.isSelectable = true; // This is a *selectable_if condition
        }
    }
    // Then check for *if if *selectable_if wasn't found
    else if (result.cleanText.startsWith('*if (')) {
        const openParenIndex = result.cleanText.indexOf('(');
        const closeParenIndex = findMatchingClosingParenthesis(result.cleanText, openParenIndex);

        if (closeParenIndex > openParenIndex && closeParenIndex < result.cleanText.length) {
            result.condition = result.cleanText.substring(openParenIndex + 1, closeParenIndex);
            result.cleanText = result.cleanText.substring(closeParenIndex + 1).trim();
            // isSelectable remains false for regular *if conditions
        }
    }

    return result;
}

/**
 * Find the index of the matching closing parenthesis
 * @param text The text to search in
 * @param openParenIndex The index of the opening parenthesis
 * @returns Index of the matching closing parenthesis or -1 if not found
 */
export const findMatchingClosingParenthesis = (text: string, openParenIndex: number): number => {
    let parenCount = 1;
    let inString = false;
    let escapeChar = false;

    for (let i = openParenIndex + 1; i < text.length; i++) {
        const char = text[i];

        // Handle string literals to avoid counting parentheses inside strings
        if (char === '"' && !escapeChar) {
            inString = !inString;
        }

        // Track escape character for string parsing
        escapeChar = (char === '\\' && !escapeChar);

        // Count parentheses outside of strings
        if (!inString) {
            if (char === '(') {
                parenCount++;
            } else if (char === ')') {
                parenCount--;
                if (parenCount === 0) {
                    return i;
                }
            }
        }
    }

    return -1; // No matching closing parenthesis found
}