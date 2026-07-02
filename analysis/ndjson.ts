import { getIO } from "../out-dir";

export class NdjsonWriter {
  private buffer: string[] = [];

  constructor(private readonly path: string) {
    getIO().writeFile(path, "");
  }

  write(record: unknown): void {
    this.buffer.push(JSON.stringify(record));
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    getIO().appendFile(this.path, this.buffer.join("\n") + "\n");
    this.buffer = [];
  }
}

export const writeNdjson = (
  path: string,
  records: Iterable<unknown>
): number => {
  const chunks: string[] = [];
  let count = 0;
  for (const record of records) {
    chunks.push(JSON.stringify(record));
    count++;
  }
  getIO().writeFile(path, chunks.join("\n") + "\n");
  return count;
};

export const ndjsonToString = (records: Iterable<unknown>): string => {
  const chunks: string[] = [];
  for (const record of records) {
    chunks.push(JSON.stringify(record));
  }
  return chunks.join("\n") + "\n";
};

export const readNdjsonSync = <T>(path: string): T[] => {
  const content = getIO().readFile(path);
  const results: T[] = [];
  for (const line of content.split("\n")) {
    if (!line) continue;
    results.push(JSON.parse(line) as T);
  }
  return results;
};
