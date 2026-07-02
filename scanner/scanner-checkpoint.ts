export interface ScannerCheckpoint {
  line: number;
  previousIndent: number | undefined;
  proseBlockStartLine: number | undefined;
  proseBlockIndent: number | undefined;
  tokenIndex: number;
}
