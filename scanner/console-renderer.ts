import { Token } from "./tokens";

interface RenderOptions {
    showLineNumbers?: boolean;
    showPositions?: boolean;
    showIndentation?: boolean;
    colorize?: boolean;
}

const DEFAULT_OPTIONS: RenderOptions = {
    showLineNumbers: true,
    showPositions: false,
    showIndentation: true,
    colorize: true
};

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

export class TokenRenderer {
    private options: RenderOptions;
    
    constructor(options?: Partial<RenderOptions>) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    
    public render(tokens: Token[]): string {
        const lines: string[] = [];
        lines.push(this.renderHeader());
        lines.push('');
        
        let i = 0;
        while (i < tokens.length) {
            const groupResult = this.renderTokenGroup(tokens, i);
            if (groupResult.rendered) {
                lines.push(groupResult.rendered);
            }
            i = groupResult.nextIndex;
        }
        
        lines.push('');
        lines.push(this.renderFooter(tokens.length));
        
        return lines.join('\n');
    }
    
    public renderToConsole(tokens: Token[]): void {
        console.log(this.render(tokens));
    }
    
    private renderHeader(): string {
        const separator = '='.repeat(80);
        return this.colorize(separator, colors.cyan) + '\n' +
               this.colorize('ChoiceScript Token Stream', colors.bright + colors.cyan) + '\n' +
               this.colorize(separator, colors.cyan);
    }
    
    private renderFooter(tokenCount: number): string {
        const separator = '='.repeat(80);
        return this.colorize(separator, colors.cyan) + '\n' +
               this.colorize(`Total tokens: ${tokenCount}`, colors.dim);
    }
    
    private renderToken(token: Token): string {
        const parts: string[] = [];
        
        // Line number
        if (this.options.showLineNumbers) {
            const lineNum = String(token.lineNumber).padStart(4, ' ');
            parts.push(this.colorize(lineNum, colors.gray));
        }
        
        // Indentation
        if (this.options.showIndentation) {
            const indent = '  '.repeat(Math.floor(token.indent));
            parts.push(indent);
        }
        
        // Token type and content
        const tokenInfo = this.renderTokenContent(token);
        parts.push(tokenInfo);
        
        // Position info (optional)
        if (this.options.showPositions) {
            parts.push(this.colorize(` @${token.position}`, colors.dim));
        }
        
        return parts.join(' ');
    }
    
    private renderTokenGroup(tokens: Token[], startIndex: number): { rendered: string; nextIndex: number } {
        const token = tokens[startIndex];
        const parts: string[] = [];
        
        // Line number
        if (this.options.showLineNumbers) {
            const lineNum = String(token.lineNumber).padStart(4, ' ');
            parts.push(this.colorize(lineNum, colors.gray));
        }
        
        // Indentation
        if (this.options.showIndentation) {
            const indent = '  '.repeat(Math.floor(token.indent));
            parts.push(indent);
        }
        
        // Collect all tokens from the same line
        let currentIndex = startIndex;
        const currentLineNumber = token.lineNumber;
        const lineParts: string[] = [];
        
        while (currentIndex < tokens.length && tokens[currentIndex].lineNumber === currentLineNumber) {
            const currentToken = tokens[currentIndex];
            
            // Render based on token type
            if (this.isExpressionToken(currentToken)) {
                const content = this.renderTokenValue(currentToken);
                if (content) {
                    lineParts.push(content);
                }
            } else {
                const content = this.renderTokenContent(currentToken);
                if (content) {
                    lineParts.push(content);
                }
            }
            
            currentIndex++;
        }
        
        parts.push(lineParts.join(' '));
        return { rendered: parts.join(' '), nextIndex: currentIndex };
    }
    
    private isExpressionToken(token: Token): boolean {
        return token.type === 'NumberLiteral' ||
               token.type === 'StringLiteral' ||
               token.type === 'BooleanLiteral' ||
               token.type === 'VariableReference' ||
               token.type === 'ArithmeticOperator' ||
               token.type === 'ComparisonOperator' ||
               token.type === 'LogicalOperator' ||
               token.type === 'OpenParenthesis' ||
               token.type === 'CloseParenthesis' || 
               token.type === 'MultiReplaceOr' ||
               token.type === 'BeginMultiReplace' ||
               token.type === 'EndMultiReplace';
    }
    
    private renderTokenValue(token: Token): string {
        switch (token.type) {
            case 'NumberLiteral':
                const numToken = token as any;
                return this.colorize(String(numToken.value), colors.cyan);
                
            case 'StringLiteral':
                const strToken = token as any;
                return this.colorize(`"${strToken.value}"`, colors.cyan);
                
            case 'BooleanLiteral':
                const boolToken = token as any;
                return this.colorize(String(boolToken.value), colors.cyan);
                
            case 'VariableReference':
                const varToken = token as any;
                return this.colorize(varToken.value, colors.yellow);
                
            case 'ArithmeticOperator':
                const arithToken = token as any;
                return this.colorize(arithToken.rawValue, colors.red);
                
            case 'ComparisonOperator':
                const compToken = token as any;
                return this.colorize(compToken.rawValue, colors.red);
                
            case 'LogicalOperator':
                const logToken = token as any;
                return this.colorize(logToken.operator, colors.red);
                
            case 'OpenParenthesis':
                return this.colorize('(', colors.white);
                
            case 'CloseParenthesis':
                return this.colorize(')', colors.white);
                
            default:
                return '';
        }
    }
    
    private renderTokenContent(token: Token): string {
        switch (token.type) {
            case 'SceneStart':
                return this.colorize(`[SCENE START: ${token.sceneName}]`, colors.bright + colors.green);
                
            case 'SceneEnd':
                return this.colorize(`[SCENE END: ${token.sceneName}]`, colors.bright + colors.red);
                
            case 'Choice':
                return this.colorize('*choice', colors.yellow);
                
            case 'FakeChoice':
                return this.colorize('*fake_choice', colors.yellow);
                
            case 'ChoiceOption':
                return this.colorize('#', colors.cyan);
                
            case 'If':
                return this.colorize('*if', colors.magenta);
                
            case 'ElseIf':
                return this.colorize('*elseif', colors.magenta);
                
            case 'Else':
                return this.colorize('*else', colors.magenta);
                
            case 'Label':
                return this.colorize('*label', colors.blue);
                
            case 'GotoLabel':
                return this.colorize('*goto', colors.blue);
                
            case 'GotoScene':
                return this.colorize('*goto_scene', colors.blue);
                
            case 'CreateVariable':
                return this.colorize('*create', colors.green);
                
            case 'CreateTempVariable':
                return this.colorize('*temp', colors.green);
                
            case 'SetVariable':
                return this.colorize('*set', colors.green);
                
            case 'SelectableIf':
                return this.colorize('*selectable_if', colors.magenta);
                
            case 'Finish':
                return this.colorize('*finish', colors.red);
                
            case 'Comment':
                const commentToken = token as any;
                const commentValue = commentToken.value || '';
                return this.colorize('*comment', colors.gray) + ' ' +
                       this.colorize(commentValue, colors.dim);
                
            case 'Prose':
                const proseToken = token as any;
                const content = proseToken.content || '';
                const preview = this.truncateText(content, 60);
                return this.colorize(`"${preview}"`, colors.white);
                
            default:
                return this.colorize(`[${token.type}]`, colors.gray);
        }
    }
    
    private colorize(text: string, color: string): string {
        if (!this.options.colorize) {
            return text;
        }
        return color + text + colors.reset;
    }
    
    private truncateText(text: string, maxLength: number): string {
        // Remove extra whitespace
        const cleaned = text.replace(/\s+/g, ' ').trim();
        
        if (cleaned.length <= maxLength) {
            return cleaned;
        }
        
        return cleaned.substring(0, maxLength - 3) + '...';
    }
}

// Convenience function
export function renderTokens(tokens: Token[], options?: Partial<RenderOptions>): string {
    const renderer = new TokenRenderer(options);
    return renderer.render(tokens);
}

export function renderTokensToConsole(tokens: Token[], options?: Partial<RenderOptions>): void {
    const renderer = new TokenRenderer(options);
    renderer.renderToConsole(tokens);
}
