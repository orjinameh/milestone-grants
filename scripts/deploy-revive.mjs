// Deploys MilestoneGrants to Portaldot V3 the way the chain accepts it: a Substrate extrinsic
// (revive.instantiateWithCode) signed by your native (5…) account, using your keystore JSON.
//
//   npm run compile
//   KEYSTORE_FILE=./my-account.json npm run deploy:portaldot      (you will be asked for the password)
//
// Nothing is sent until you confirm the printed cost estimate. The keystore never leaves your machine.
import fs from "node:fs";
import readline from "node:readline";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, keccakAsHex } from "@polkadot/util-crypto";

const WS = process.env.PORTALDOT_WS || "wss://test-node-v3.portaldot.dev";
const RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const ARTIFACT = "artifacts/contracts/MilestoneGrants.sol/MilestoneGrants.json";
const CODE_LIMIT = 10240; // bytes, deployed-code limit reported for this chain
const fail = (m) => { console.error("\n✗ " + m + "\n"); process.exit(1); };

function ask(q, hidden = false) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
  });
}
const big = (x) => BigInt(x?.toString?.() ?? x);
const fmtTok = (v, dec) => { const s = v.toString().padStart(dec + 1, "0"); return `${s.slice(0, -dec)}.${s.slice(-dec).slice(0, 4)}`; };

async function main() {
  // 1. artifact + size
  if (!fs.existsSync(ARTIFACT)) fail(`${ARTIFACT} not found. Run: npm run compile`);
  const art = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const code = art.bytecode;
  const deployedSize = (art.deployedBytecode.length - 2) / 2;
  const initSize = (code.length - 2) / 2;
  console.log(`Deployed code: ${deployedSize} bytes (limit ${CODE_LIMIT}). Init code: ${initSize} bytes.`);
  if (deployedSize > CODE_LIMIT) fail(`The contract is ${deployedSize - CODE_LIMIT} bytes over the ${CODE_LIMIT}-byte limit. Check hardhat.config.cjs has viaIR: true and optimizer runs: 1, then recompile. If it is still too big, tell me and I will slim the contract.`);

  // 2. keystore
  const file = process.env.KEYSTORE_FILE;
  if (!file || !fs.existsSync(file)) fail("Set KEYSTORE_FILE to the path of your keystore JSON, e.g. KEYSTORE_FILE=./my-account.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof json.encoded !== "string") fail("That file is not a keystore (it has no \"encoded\" field). Use the encrypted key file, not the account info file.");
  await cryptoWaitReady();
  const pair = new Keyring({ type: "sr25519", ss58Format: 42 }).createFromJson(json);
  const password = process.env.KEYSTORE_PASSWORD ?? (await ask("Keystore password: ", true));
  try { pair.decodePkcs8(password); } catch { fail("Wrong password for this keystore."); }
  console.log("Deploying from", pair.address);

  // 3. chain
  const api = await ApiPromise.create({ provider: new WsProvider(WS) });
  if (!api.tx.revive?.instantiateWithCode) fail("This chain has no revive.instantiateWithCode. Check PORTALDOT_WS points at the V3 testnet.");
  const dec = api.registry.chainDecimals[0], sym = api.registry.chainTokens[0];
  const acct = await api.query.system.account(pair.address);
  const free = big(acct.data.free);
  console.log(`Balance: ${fmtTok(free, dec)} ${sym}`);

  // 4. dry run for weight + storage deposit
  const dry = await api.call.reviveApi.instantiate(pair.address, 0, null, null, { Upload: code }, "0x", null);
  if (dry.result.isErr) fail("Dry run failed: " + dry.result.asErr.toString());
  const okv = dry.result.asOk;
  const rflags = Number(okv.result?.flags?.bits ?? 0);
  if (rflags & 1) fail("The constructor reverted in the dry run.");
  const w = dry.weightRequired ?? dry.gasRequired;
  const d = dry.maxStorageDeposit ?? dry.storageDeposit;
  const deposit = d == null ? 0n : d.isCharge ? big(d.asCharge) : d.isRefund ? 0n : big(d);
  const weight = { refTime: (big(w.refTime) * 12n / 10n).toString(), proofSize: (big(w.proofSize) * 12n / 10n).toString() };
  const limit = deposit * 12n / 10n + 1_000_000n;
  const predicted = okv.addr?.toHex?.();
  console.log(`Storage deposit (refundable hold): about ${fmtTok(deposit, dec)} ${sym}`);
  if (free < limit) fail(`Not enough ${sym}. You have ${fmtTok(free, dec)} and the deposit alone can reach ${fmtTok(limit, dec)}. Ask the Portaldot admins for more testnet tokens (give your address starting with 5).`);

  if ((process.env.YES ?? (await ask("Deploy now? (y/N) "))).toLowerCase().startsWith("y") === false) { console.log("Cancelled. Nothing was sent."); process.exit(0); }

  // 5. submit
  const tx = api.tx.revive.instantiateWithCode(0, weight, limit.toString(), code, "0x", null);
  const events = await new Promise((resolve, reject) => {
    tx.signAndSend(pair, (res) => {
      if (res.dispatchError) {
        let m = res.dispatchError.toString();
        try { if (res.dispatchError.isModule) { const e = api.registry.findMetaError(res.dispatchError.asModule); m = `${e.section}.${e.name}: ${e.docs.join(" ")}`; } } catch {}
        return reject(new Error(m));
      }
      if (res.status.isInBlock) { console.log("In block", res.status.asInBlock.toHex()); resolve(res.events); }
    }).catch(reject);
  }).catch((e) => fail("Deployment failed: " + e.message));

  // 6. contract address
  let address;
  for (const { event } of events) {
    if (event.section === "revive" && event.method === "Instantiated") address = (event.data.contract ?? event.data[1])?.toHex?.();
  }
  address ??= predicted;
  if (!address) fail("Deployed, but I could not read the contract address from the events. Look for revive.Instantiated in the block on the node console.");
  address = address.toLowerCase();
  console.log("Contract address:", address);

  // 7. verify through the EVM RPC (reads work there)
  await new Promise((r) => setTimeout(r, 4000));
  const sel = keccakAsHex("grantCount()").slice(0, 10);
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: address, data: sel }, "latest"] }) }).then((x) => x.json());
  const live = !r.error && typeof r.result === "string" && /^0x0{64}$/.test(r.result);
  console.log(live ? "✓ Verified: grantCount() returns 0 over the EVM RPC." : `! Could not verify over the EVM RPC yet (${r.error?.message ?? r.result}). Wait a few blocks and try the page; the address may still be correct.`);

  // 8. record + wire up the app
  fs.writeFileSync("deployment.json", JSON.stringify({ address, deployer: pair.address, deployedAt: new Date().toISOString(), deployedBytes: deployedSize }, null, 2) + "\n");
  const cfgPath = "public/config.json";
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); cfg.registryAddress = address;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log("public/config.json updated. Commit deployment.json and public/config.json.");
  await api.disconnect();
  process.exit(0);
}
main().catch((e) => fail(e.stack || e.message));
