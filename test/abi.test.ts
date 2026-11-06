import test from "node:test";
import assert from "node:assert/strict";
import { encodeCall, selectorOf, encodeParams, isDynamic } from "../lib/abi";
import { bytesToHex } from "../lib/hex";
import { lookupCommit } from "../lib/github";

test("Solidity-docs vector: baz(uint32,bool)", () => {
  assert.equal(bytesToHex(selectorOf("baz(uint32,bool)")), "0xcdcd77c0");
  assert.equal(encodeCall("baz(uint32,bool)", ["uint", "bool"], [69, true]),
    "0xcdcd77c0" + "0000000000000000000000000000000000000000000000000000000000000045" + "0000000000000000000000000000000000000000000000000000000000000001");
});
test("Solidity-docs vector: sam(bytes,bool,uint256[]) with mixed dynamic types", () => {
  const exp = "0xa5643bf2" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "00000000000000000000000000000000000000000000000000000000000000a0" +
    "0000000000000000000000000000000000000000000000000000000000000004" +
    "6461766500000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000003" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "0000000000000000000000000000000000000000000000000000000000000003";
  assert.equal(encodeCall("sam(bytes,bool,uint256[])", ["bytes", "bool", "uint[]"], ["0x64617665", true, [1, 2, 3]]), exp);
});
test("dynamic tuple is a single offset word; static tuple is inline", () => {
  const dyn = encodeParams([{ tuple: ["uint", "string"] }], [[7, "hi"]]);
  assert.equal(dyn.length, 32 + 32 * 2 + 32 * 2);           // offset + (uint, offset) + (len, data)
  assert.equal(isDynamic({ tuple: ["uint", "address"] }), false);
  assert.equal(encodeParams([{ tuple: ["uint", "address"] }], [[1, "0x" + "11".repeat(20)]]).length, 64);
});
test("bytes32[] is dynamic and encodes length + one word per id", () => {
  assert.equal(isDynamic("bytes32[]"), true);
  const id = (n: string) => "0x" + n.repeat(32);
  const enc = encodeParams(["bytes32[]"], [[id("11"), id("22")]]);
  assert.equal(enc.length, 32 * 4);                       // offset, length, two ids
  assert.equal(bytesToHex(enc.slice(32 * 2, 32 * 3)), id("11"));
});
test("github lookup validates inputs without network", async () => {
  assert.equal((await lookupCommit("bad repo", "a".repeat(40))).ok, false);
  assert.equal((await lookupCommit("a/b", "xyz")).ok, false);
});
