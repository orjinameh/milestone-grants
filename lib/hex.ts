export function bytesToHex(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 !== 0 || /[^0-9a-fA-F]/.test(s)) throw new Error("bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function bigToBytes32(n: bigint): Uint8Array {
  if (n < 0n || n >= 1n << 256n) throw new Error("uint256 out of range");
  return hexToBytes(n.toString(16).padStart(64, "0"));
}
export function bytesToBig(b: Uint8Array): bigint {
  return b.length === 0 ? 0n : BigInt(bytesToHex(b));
}
export function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }
