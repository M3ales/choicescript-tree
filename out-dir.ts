import type { IO } from "./io";

export const OUT_DIR = "./out";

export const outPath = (filename: string): string =>
  `${OUT_DIR}/${filename}`;

let _io: IO;

export const setIO = (io: IO): void => { _io = io; };

export const getIO = (): IO => {
  if (!_io) throw new Error("IO not initialized. Call setIO() before pipeline.");
  return _io;
};

export const ensureOutDir = (): void => {
  getIO().mkdir(OUT_DIR);
};
