import type { AsyncIO } from "../io";

export class OpfsIO implements AsyncIO {
  private root: FileSystemDirectoryHandle;
  private dirs = new Map<string, FileSystemDirectoryHandle>();

  private constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  static async create(): Promise<OpfsIO> {
    const root = await navigator.storage.getDirectory();
    return new OpfsIO(root);
  }

  async readFile(path: string): Promise<string> {
    const { dir, name } = await this.resolve(path);
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { dir, name } = await this.resolve(path);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { dir, name } = await this.resolve(path);
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.getDir(path);
  }

  async seed(files: Map<string, string>): Promise<void> {
    for (const [path, content] of files) {
      await this.writeFile(path, content);
    }
  }

  async getAll(prefix: string = ""): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    await this.collectEntries(this.root, prefix, result);
    return result;
  }

  async listAll(prefix: string = ""): Promise<{ path: string; size: number }[]> {
    const result: { path: string; size: number }[] = [];
    await this.collectMeta(this.root, prefix, result);
    return result;
  }

  async clear(): Promise<void> {
    for await (const key of (this.root as any).keys()) {
      await this.root.removeEntry(key, { recursive: true });
    }
    this.dirs.clear();
  }

  private async collectMeta(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    result: { path: string; size: number }[],
  ): Promise<void> {
    for await (const [name, handle] of (dir as any).entries()) {
      const fullPath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        result.push({ path: fullPath, size: file.size });
      } else {
        await this.collectMeta(handle as FileSystemDirectoryHandle, fullPath, result);
      }
    }
  }

  private async collectEntries(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    result: Map<string, string>,
  ): Promise<void> {
    for await (const [name, handle] of (dir as any).entries()) {
      const fullPath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        result.set(fullPath, await file.text());
      } else {
        await this.collectEntries(handle as FileSystemDirectoryHandle, fullPath, result);
      }
    }
  }

  private async getDir(path: string): Promise<FileSystemDirectoryHandle> {
    const normalized = this.normalize(path);
    const cached = this.dirs.get(normalized);
    if (cached) return cached;

    const segments = normalized.split("/").filter(Boolean);
    let current = this.root;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create: true });
    }
    this.dirs.set(normalized, current);
    return current;
  }

  private async resolve(path: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const normalized = this.normalize(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash === -1) {
      return { dir: this.root, name: normalized };
    }
    const dirPath = normalized.slice(0, lastSlash);
    const name = normalized.slice(lastSlash + 1);
    return { dir: await this.getDir(dirPath), name };
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "");
  }
}
