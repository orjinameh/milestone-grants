// Deploys MilestoneGrants to Portaldot V3 from your EVM (secp256k1) account. No JSON files: one private key.
//
//   npm run compile
//   DEPLOYER_PRIVATE_KEY=0x… npm run deploy:portaldot        (or omit it and you will be asked, hidden)
//
// Use a TESTNET-ONLY key. Everything before the final "y" is read-only. The key stays on your machine.
import fs from "node:fs";
import readline from "node:readline";
import { ethers } from "ethers";
import { evmToSs58 } from "./address-map.mjs";

const RPC = process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const CHAIN_ID = 420420777n;
const ARTIFACT = "artifacts/contracts/MilestoneGrants.sol/MilestoneGrants.json";
const CODE_LIMIT = 10240; // deployed-code size cap reported for Portaldot V3
const fail = (m) => { console.error("\n✗ " + m + "\n"); process.exit(1); };
const ok = (m) => console.log("✓ " + m);

function ask(q, hidden = false) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
  });
}

async function main() {
  // 1. compiled contract + size
  if (!fs.existsSync(ARTIFACT)) fail(`${ARTIFACT} not found. Run: npm run compile`);
  const art = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const size = (art.deployedBytecode.length - 2) / 2;
  if (size > CODE_LIMIT) fail(`The contract is ${size} bytes, ${size - CODE_LIMIT} over the ${CODE_LIMIT}-byte limit. Check hardhat.config.cjs (viaIR true, optimizer runs 1, evmVersion cancun), recompile, and tell me if it is still too big.`);
  ok(`Contract compiled: ${size} bytes of ${CODE_LIMIT} allowed.`);

  // 2. key + account
  let key = process.env.DEPLOYER_PRIVATE_KEY || (await ask("Deployer private key (testnet only): ", true));
  if (!key.startsWith("0x")) key = "0x" + key;
  let wallet;
  try { wallet = new ethers.Wallet(key); } catch { fail("That is not a valid private key."); }
  console.log(`Deployer EVM address:      ${wallet.address}`);
  console.log(`Mapped Substrate address:  ${evmToSs58(wallet.address)}   (tPOT is sent here)`);

  // 3. chain + balance
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  let net, balance, fee;
  try { [net, balance, fee] = await Promise.all([provider.getNetwork(), provider.getBalance(wallet.address), provider.getFeeData()]); }
  catch (e) { fail(`Could not reach ${RPC}: ${e.message}`); }
  if (net.chainId !== CHAIN_ID) fail(`Connected to chain ${net.chainId}, expected ${CHAIN_ID}.`);
  console.log(`Balance: ${ethers.formatEther(balance)} POT`);
  if (balance === 0n) fail(`This account has no tPOT. Ask the Portaldot admins to send tPOT to ${evmToSs58(wallet.address)} (the Substrate address above; run \`node scripts/address-map.mjs ${wallet.address}\` any time to print it).`);

  // 4. cost estimate (read-only)
  const signer = wallet.connect(provider);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, signer);
  const deployTx = await factory.getDeployTransaction();
  let gas;
  try { gas = await provider.estimateGas({ ...deployTx, from: wallet.address }); }
  catch (e) { fail(`The chain rejected the deployment estimate: ${e.shortMessage || e.message}\nIf this says Invalid Transaction, the EVM write path is not accepting this account yet. Tell me the exact message.`); }
  const price = fee.gasPrice ?? 0n;
  if (price === 0n) fail("The chain reported a gas price of 0, which I do not trust. Tell me this output.");
  const cost = gas * price;
  console.log(`Estimated gas: ${gas}  gas price: ${price}  estimated cost: ${ethers.formatEther(cost)} POT`);
  console.log("  (most of this is the chain's storage deposit for the contract's code; gas you do not use is refunded)");
  // The node reserves gasLimit x gasPrice up front. Keep a small margin, never more than the balance, and send a legacy
  // transaction with this exact price so the reservation is predictable (no EIP-1559 maxFee doubling).
  const affordable = balance / price;
  let gasLimit = (gas * 105n) / 100n;
  if (gasLimit > affordable) gasLimit = affordable;
  if (gasLimit < gas) fail(`Not enough POT: this deployment needs about ${ethers.formatEther(cost)} POT up front and you have ${ethers.formatEther(balance)}. Ask the admins for more.`);
  console.log(`  gas limit to send: ${gasLimit}  (at most ${ethers.formatEther(gasLimit * price)} POT reserved, the unused part is refunded)`);

  if ((process.env.YES ?? (await ask("Deploy now? (y/N) "))).toLowerCase().startsWith("y") === false) { console.log("Cancelled. Nothing was sent."); process.exit(0); }

  // 5. deploy
  let contract;
  try {
    contract = await factory.deploy({ gasLimit, gasPrice: price, type: 0 });
    console.log("Sent:", contract.deploymentTransaction().hash, " waiting for confirmation…");
    await contract.waitForDeployment();
  } catch (e) { fail(`Deployment failed: ${e.shortMessage || e.message}\nThe node said: ${e.info?.error?.message || e.error?.message || e.info?.responseBody || "(no detail)"}\nIf this says Invalid Transaction, the chain is rejecting EVM-signed writes from this account. Tell me the exact message.`); }
  const address = await contract.getAddress();
  ok(`Deployed at ${address}`);

  // 6. verify by reading it back
  const count = await new ethers.Contract(address, art.abi, provider).grantCount();
  count === 0n ? ok("Verified: grantCount() returns 0.") : console.log("! grantCount() returned", count.toString());

  // 7. wire up the app
  const out = { address, chainId: Number(net.chainId), deployTx: contract.deploymentTransaction().hash, deployer: wallet.address, deployedAt: new Date().toISOString() };
  fs.writeFileSync("deployment.json", JSON.stringify(out, null, 2) + "\n");
  const cfgPath = "public/config.json";
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  Object.assign(cfg, { registry: address, rpcUrl: RPC, chainId: Number(net.chainId), nativeSymbol: "POT", nativeDecimals: 18 });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  ok("public/config.json now points at Portaldot V3. Commit deployment.json and public/config.json.");
}
main().catch((e) => fail(e.stack || e.message));
