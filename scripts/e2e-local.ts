// End-to-end against a LOCAL Hardhat node, driving the app's own encoders and readers (lib/api.ts, lib/chain.ts),
// exactly the bytes the browser will send. Run:  npx hardhat node   (terminal 1)   then   npm run e2e:local   (terminal 2)
import { readFileSync } from "node:fs";
import { calls } from "../lib/api";
import { readGrant, readGrantCount } from "../lib/chain";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const POT = 10n ** 18n, COMMIT = "0x" + "ab".repeat(20), ZERO = "0x" + "00".repeat(32);
const idOf = (a: string) => a.toLowerCase() + "ee".repeat(12);
let n = 0;
async function rpc(method: string, params: unknown[] = []): Promise<any> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
  const j: any = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const hex = (v: bigint) => "0x" + v.toString(16);
let pass = 0;
const ok = (c: unknown, msg: string) => { if (!c) throw new Error("FAILED: " + msg); pass++; console.log("  ✓", msg); };
async function expectRevert(p: Promise<unknown>, msg: string) {
  try { await p; } catch { ok(true, msg); return; }
  throw new Error("FAILED (did not revert): " + msg);
}

async function main() {
  if (parseInt(await rpc("eth_chainId"), 16) !== 31337) throw new Error("Expected a local Hardhat node (chain 31337).");
  const accts: string[] = await rpc("eth_accounts");
  const [funder, recipient, r1, r2, r3] = accts;
  const art = JSON.parse(readFileSync("artifacts/contracts/MilestoneGrants.sol/MilestoneGrants.json", "utf8"));
  const deployHash = await rpc("eth_sendTransaction", [{ from: funder, data: art.bytecode, gas: hex(12_000_000n) }]);
  const registry = (await rpc("eth_getTransactionReceipt", [deployHash])).contractAddress as string;
  const call = async (data: string) => rpc("eth_call", [{ to: registry, data }, "latest"]);
  const send = async (from: string, data: string, value = 0n) => {
    const h = await rpc("eth_sendTransaction", [{ from, to: registry, data, value: hex(value), gas: hex(5_000_000n) }]);
    const rc = await rpc("eth_getTransactionReceipt", [h]);
    if (rc.status !== "0x1") throw new Error("transaction reverted");
    return rc;
  };
  const bal = async (a: string) => BigInt(await rpc("eth_getBalance", [a, "latest"]));
  const now = async () => parseInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp, 16);
  const skip = async (s: number) => { await rpc("evm_increaseTime", [s]); await rpc("evm_mine"); };

  console.log("registry", registry);
  ok((await readGrantCount(call)) === 0, "fresh registry has 0 grants (read decoded by lib/chain)");

  const amounts = [POT, 2n * POT];
  const reviewers = [r1, r2, r3].map(idOf);
  const mk = async (days: number, value = 3n * POT) => send(funder, calls.createGrant({
    funder: "0x" + idOf(funder), token: ZERO, recipient: "0x" + idOf(recipient), deadline: (await now()) + days * 86400, threshold: 2, repo: "o/r",
    reviewers: reviewers.map((x) => "0x" + x), amounts: amounts.map(String),
  }), value);

  await mk(7);
  ok((await readGrantCount(call)) === 1, "grant created through the app's encoder");
  let g = await readGrant(call, 0, "0x" + idOf(r1));
  ok(g.repo === "o/r" && g.total === 3n * POT && g.threshold === 2 && g.milestones.length === 2, "grant read back identically by the app's decoder");
  ok(g.funder.toLowerCase().includes(funder.slice(2).toLowerCase()) && g.reviewers.length === 3, "funder and reviewers round-trip");

  await expectRevert(send(funder, calls.claim(0, 0, COMMIT, "")), "funder cannot claim");
  await send(recipient, calls.claim(0, 0, COMMIT, "https://github.com/o/r/commit/abab"));
  await expectRevert(send(recipient, calls.claim(0, 1, COMMIT, "")), "cannot skip ahead");
  g = await readGrant(call, 0, "0x" + idOf(r1));
  ok(g.milestones[0].status === 1 && g.milestones[0].commit.toLowerCase() === COMMIT, "claimed commit visible in the UI model");

  const before = await bal(recipient);
  await send(r1, calls.approve(0, 0));
  ok((await bal(recipient)) === before, "1 of 2 approvals pays nothing");
  g = await readGrant(call, 0, "0x" + idOf(r1));
  ok(g.milestones[0].viewerVoted === true, "viewerVoted true for the reviewer who voted");
  await expectRevert(send(r1, calls.approve(0, 0)), "double vote reverts");
  await send(r2, calls.approve(0, 0));
  ok((await bal(recipient)) === before + POT, "2nd approval pays exactly 1 POT");
  ok((await bal(registry)) === 2n * POT, "contract holds exactly the unreleased 2 POT");
  g = await readGrant(call, 0);
  ok(g.milestones[0].status === 2 && g.released === POT, "milestone shows Released");

  await send(recipient, calls.claim(0, 1, "0x" + "cd".repeat(20), ""));
  await send(r3, calls.approve(0, 1)); // 1 of 2, left hanging
  await expectRevert(send(funder, calls.reclaim(0)), "reclaim before the deadline reverts");
  await skip(8 * 86400);
  const fb = await bal(funder);
  const rc = await send(funder, calls.reclaim(0));
  const gasCost = BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice);
  ok((await bal(funder)) === fb - gasCost + 2n * POT, "funder refunded exactly the unreleased 2 POT");
  ok((await bal(registry)) === 0n, "contract is empty");
  g = await readGrant(call, 0);
  ok(g.closed === true, "grant shows closed");
  await expectRevert(send(r2, calls.approve(0, 1)), "no approvals after close");

  console.log(`\nALL ${pass} CHECKS PASSED against the local chain.`);
}
main().catch((e) => { console.error("\n" + e.message); process.exit(1); });
