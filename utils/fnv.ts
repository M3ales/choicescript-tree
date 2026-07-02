export const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const fnvMixStr = (hash: number, s: string): number => {
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};

export const fnvMixInt = (hash: number, n: number): number => {
  hash ^= (n & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= ((n >>> 8) & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= ((n >>> 16) & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= ((n >>> 24) & 0xff);
  return Math.imul(hash, FNV_PRIME) >>> 0;
};
