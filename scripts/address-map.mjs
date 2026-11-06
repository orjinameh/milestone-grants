// Shows the Substrate (5…) address that an EVM (0x…) account maps to on Portaldot V3, and back.
// Zero dependencies. Give the 5… address to the Portaldot admins so they send testnet tPOT to the right place.
//
//   node scripts/address-map.mjs 0xYourEvmAddress
//   node scripts/address-map.mjs 5YourSubstrateAddress
import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const blake2b512 = (b) => createHash("blake2b512").update(b).digest();

function b58encode(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}
function b58decode(str) {
  let n = 0n;
  for (const c of str) { const i = ALPHABET.indexOf(c); if (i < 0) throw new Error("not a valid SS58 address"); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex;
  const body = Buffer.from(hex, "hex");
  const zeros = [...str].findIndex((c) => c !== "1");
  return Buffer.concat([Buffer.alloc(zeros < 0 ? str.length : zeros), body]);
}
/** SS58 encoding of a 32-byte account id (simple-account format, prefix < 64). */
export function ss58Encode(pubkey32, prefix = 42) {
  const data = Buffer.concat([Buffer.from([prefix]), pubkey32]);
  const check = blake2b512(Buffer.concat([Buffer.from("SS58PRE"), data])).subarray(0, 2);
  return b58encode(Buffer.concat([data, check]));
}
export function ss58Decode(addr) {
  const raw = b58decode(addr);
  if (raw.length !== 35) throw new Error("unsupported address length");
  const data = raw.subarray(0, 33), check = raw.subarray(33);
  const want = blake2b512(Buffer.concat([Buffer.from("SS58PRE"), data])).subarray(0, 2);
  if (!check.equals(want)) throw new Error("bad SS58 checksum");
  return { prefix: data[0], pubkey: data.subarray(1) };
}
/** An EVM account's Substrate id on pallet-revive: its 20 bytes followed by twelve 0xEE bytes. */
export const evmToSs58 = (h160, prefix = 42) => ss58Encode(Buffer.concat([Buffer.from(h160.replace(/^0x/, ""), "hex"), Buffer.alloc(12, 0xee)]), prefix);
export function ss58ToEvm(addr) {
  const { pubkey } = ss58Decode(addr);
  if (!pubkey.subarray(20).every((b) => b === 0xee)) return null; // a native account, not derived from an EVM address
  return "0x" + pubkey.subarray(0, 20).toString("hex");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const a = process.argv[2];
  if (!a) { console.error("Usage: node scripts/address-map.mjs <0x… or 5…>"); process.exit(1); }
  try {
    if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
      console.log("EVM address:      ", a.toLowerCase());
      console.log("Substrate address:", evmToSs58(a));
      console.log("\nSend testnet tPOT to the Substrate address above (that is how Portaldot funds an EVM account).");
    } else {
      const e = ss58ToEvm(a);
      console.log("Substrate address:", a);
      console.log(e ? `EVM address:       ${e}` : "This is a native Substrate account, not one derived from an EVM address.");
    }
  } catch (e) { console.error("✗ " + e.message); process.exit(1); }
}
