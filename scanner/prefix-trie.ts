interface TrieNode {
  children: Map<string, TrieNode>;
  isTerminal: boolean;
}

export class PrefixTrie {
  private root: TrieNode = { children: new Map(), isTerminal: false };

  constructor(names: string[]) {
    for (const name of names) {
      let node = this.root;
      for (let i = 0; i < name.length; i++) {
        const ch = name[i];
        let child = node.children.get(ch);
        if (!child) {
          child = { children: new Map(), isTerminal: false };
          node.children.set(ch, child);
        }
        node = child;
      }
      node.isTerminal = true;
    }
  }

  match(
    expression: string,
    cursor: number,
    isWordChar: (ch: string) => boolean,
  ): { matched: string | null; rawValue: string; newCursor: number } {
    let node = this.root;
    let lastTerminalLen = -1;
    let i = cursor;

    while (i < expression.length) {
      const ch = expression[i].toLowerCase();
      const child = node.children.get(ch);
      if (!child) break;
      node = child;
      i++;
      if (node.isTerminal) {
        lastTerminalLen = i - cursor;
      }
    }

    if (lastTerminalLen > 0) {
      const endPos = cursor + lastTerminalLen;
      if (endPos < expression.length && isWordChar(expression[endPos])) {
        return { matched: null, rawValue: "", newCursor: cursor };
      }
      return {
        matched: expression.substring(cursor, endPos).toLowerCase(),
        rawValue: expression.substring(cursor, endPos),
        newCursor: endPos,
      };
    }

    return { matched: null, rawValue: "", newCursor: cursor };
  }
}
