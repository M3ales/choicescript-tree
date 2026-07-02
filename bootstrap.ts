import { setIO, getIO } from "./out-dir";

try {
  getIO();
} catch {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { NodeIO } = await import("./io/node-io");
    setIO(new NodeIO());
  }
}
