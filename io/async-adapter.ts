import type { IO, AsyncIO } from "../io";

export class AsyncToSyncAdapter implements IO {
  private cache = new Map<string, string>();
  private written = new Map<string, string>();
  private dirsMade = new Set<string>();

  seed(files: Map<string, string>): void {
    for (const [k, v] of files) this.cache.set(this.normalize(k), v);
  }

  readFile(path: string): string {
    const key = this.normalize(path);
    const content = this.written.get(key) ?? this.cache.get(key);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  writeFile(path: string, content: string): void {
    this.written.set(this.normalize(path), content);
  }

  appendFile(path: string, content: string): void {
    const key = this.normalize(path);
    const existing = this.written.get(key) ?? "";
    this.written.set(key, existing + content);
  }

  exists(path: string): boolean {
    const key = this.normalize(path);
    return this.written.has(key) || this.cache.has(key);
  }

  mkdir(_path: string): void {
    this.dirsMade.add(this.normalize(_path));
  }

  async flushTo(target: AsyncIO): Promise<void> {
    for (const dir of this.dirsMade) {
      await target.mkdir(dir);
    }
    for (const [path, content] of this.written) {
      await target.writeFile(path, content);
    }
  }

  getWritten(): Map<string, string> {
    return new Map(this.written);
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "");
  }
}
