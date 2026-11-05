// npx hardhat run scripts/deploy.cjs --network portaldot     (DEPLOYER_PRIVATE_KEY = testnet-only key funded with POT)
const hre = require("hardhat"); const fs = require("fs");
async function main() {
  const F = await hre.ethers.getContractFactory("MilestoneGrants");
  const c = await F.deploy(); const tx = c.deploymentTransaction(); await c.waitForDeployment();
  const address = await c.getAddress(); const net = await hre.ethers.provider.getNetwork();
  const out = { address, chainId: Number(net.chainId), deployTx: tx.hash, deployedAt: new Date().toISOString() };
  fs.writeFileSync("deployment.json", JSON.stringify(out, null, 2)); console.log(out);
  const cfgPath = "public/config.json"; const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); cfg.registryAddress = address;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n"); console.log("public/config.json updated with the registry address.");
}
main().catch((e) => { console.error(e); process.exit(1); });
