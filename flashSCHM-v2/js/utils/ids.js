// IDs are identity only; they never participate in scheduling tie breaks.
let counter = 0;
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export function newId() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  // Older/file browsers still need usable IDs, not cryptographic tokens.
  return `local-${session}-${++counter}`;
}
