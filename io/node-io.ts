import fs from "node:fs";
import type { IO } from "../io";

export class NodeIO implements IO {
  readFile(path: string): string {
    return fs.readFileSync(path, "utf-8");
  }
  writeFile(path: string, content: string): void {
    fs.writeFileSync(path, content, "utf-8");
  }
  appendFile(path: string, content: string): void {
    fs.appendFileSync(path, content, "utf-8");
  }
  exists(path: string): boolean {
    return fs.existsSync(path);
  }
  mkdir(path: string): void {
    fs.mkdirSync(path, { recursive: true });
  }
}
