/** Short, case-insensitive codes suitable for sharing and typing on a phone. */
export const PROFILE_SEED_LENGTH = 8;
export function parseProfileSeed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const seed = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(seed) ? seed : null;
}

export function randomProfileSeed(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let seed = "";
  for (let i = 0; i < PROFILE_SEED_LENGTH; i++) seed += alphabet[Math.floor(Math.random() * alphabet.length)];
  return seed;
}

/** Stable FNV-1a derivation isolates each world's generation from gameplay RNG. */
export function profileWorldSeed(seed: string, world: number): number {
  const text = `breach.world.v1:${seed}:${world}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}
