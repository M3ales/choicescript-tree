import type { IO } from "../io";

export class MemoryIO implements IO {
  private files = new Map<string, string>();

  readFile(path: string): string {
    const content = this.files.get(this.normalize(path));
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  writeFile(path: string, content: string): void {
    this.files.set(this.normalize(path), content);
  }

  appendFile(path: string, content: string): void {
    const key = this.normalize(path);
    const existing = this.files.get(key) ?? "";
    this.files.set(key, existing + content);
  }

  exists(path: string): boolean {
    return this.files.has(this.normalize(path));
  }

  mkdir(_path: string): void {}

  seed(files: Map<string, string>): void {
    for (const [k, v] of files) this.files.set(this.normalize(k), v);
  }

  getAll(): Map<string, string> {
    return new Map(this.files);
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/");
  }
}
