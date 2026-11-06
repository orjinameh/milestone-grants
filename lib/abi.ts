// Minimal ABI encoder/decoder (no dependencies) for the MilestoneGrants UI.
import { keccak256 } from "./keccak";
import { bigToBytes32, bytesToBig, bytesToHex, concat, hexToBytes, utf8 } from "./hex";

export type AbiType = "address" | "bool" | "uint" | "bytes32" | "bytes20" | "string" | "bytes" | "address[]" | "bytes32[]" | "uint[]" | { tuple: AbiType[] };

const isTuple = (t: AbiType): t is { tuple: AbiType[] } => typeof t === "object";
export const isDynamic = (t: AbiType): boolean =>
  isTuple(t) ? t.tuple.some(isDynamic) : t === "string" || t === "bytes" || t === "address[]" || t === "bytes32[]" || t === "uint[]";
const staticSize = (t: AbiType): number => (isTuple(t) && !isDynamic(t) ? t.tuple.reduce((n, c) => n + staticSize(c), 0) : 32);
const pad32 = (b: Uint8Array) => { const o = new Uint8Array(Math.ceil(b.length / 32) * 32); o.set(b); return o; };
const word = (n: bigint | number) => bigToBytes32(BigInt(n));

function encodeOne(t: AbiType, v: any): Uint8Array {
  if (isTuple(t)) return encodeParams(t.tuple, v);
  switch (t) {
    case "address": { const b = hexToBytes(v); if (b.length !== 20) throw new Error("bad address"); return concat(new Uint8Array(12), b); }
    case "bool": return word(v ? 1 : 0);
    case "uint": return word(BigInt(v));
    case "bytes32": { const b = hexToBytes(v); if (b.length !== 32) throw new Error("bad bytes32"); return b; }
    case "bytes20": { const b = hexToBytes(v); if (b.length !== 20) throw new Error("bad bytes20"); return pad32(b); }
    case "string": { const b = utf8(v); return concat(word(b.length), pad32(b)); }
    case "bytes": { const b = hexToBytes(v); return concat(word(b.length), pad32(b)); }
    case "address[]": return concat(word(v.length), ...v.map((x: string) => encodeOne("address", x)));
    case "bytes32[]": return concat(word(v.length), ...v.map((x: string) => encodeOne("bytes32", x)));
    case "uint[]": return concat(word(v.length), ...v.map((x: any) => encodeOne("uint", x)));
  }
}

export function encodeParams(types: AbiType[], values: any[]): Uint8Array {
  if (types.length !== values.length) throw new Error("arity mismatch");
  const headSize = types.reduce((n, t) => n + (isDynamic(t) ? 32 : staticSize(t)), 0);
  const heads: Uint8Array[] = [], tails: Uint8Array[] = [];
  let tailLen = 0;
  types.forEach((t, i) => {
    const enc = encodeOne(t, values[i]);
    if (isDynamic(t)) { heads.push(word(headSize + tailLen)); tails.push(enc); tailLen += enc.length; }
    else heads.push(enc);
  });
  return concat(...heads, ...tails);
}

export const selectorOf = (sig: string) => keccak256(utf8(sig)).slice(0, 4);
export function encodeCall(sig: string, types: AbiType[], values: any[]): string {
  return bytesToHex(concat(selectorOf(sig), encodeParams(types, values)));
}

// ---- decoding (static words + a single top-level string) ----
export function words(hex: string): Uint8Array[] {
  const b = hexToBytes(hex), out: Uint8Array[] = [];
  for (let i = 0; i + 32 <= b.length; i += 32) out.push(b.slice(i, i + 32));
  return out;
}
export const wBig = (w: Uint8Array) => bytesToBig(w);
export const wAddr = (w: Uint8Array) => bytesToHex(w.slice(12));
/** A full 32-byte word as 0x… hex: an AccountId32 (the public key behind a 5… address). */
export const wId = (w: Uint8Array) => bytesToHex(w);
export const wBytes20 = (w: Uint8Array) => bytesToHex(w.slice(0, 20));
export function decodeString(hex: string): string {
  const b = hexToBytes(hex);
  const off = Number(bytesToBig(b.slice(0, 32)));
  const len = Number(bytesToBig(b.slice(off, off + 32)));
  return new TextDecoder().decode(b.slice(off + 32, off + 32 + len));
}
