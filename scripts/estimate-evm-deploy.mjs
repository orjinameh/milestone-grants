import { ethers } from "ethers";
import fs from "node:fs";

const RPC = "https://test-evm-rpc-v3.portaldot.dev";
const WALLET = "0xf3a73e7fa1b01f0f77970fa81e922bac589b64a4";

const artifact = JSON.parse(
  fs.readFileSync(
    "artifacts/contracts/MilestoneGrants.sol/MilestoneGrants.json",
    "utf8"
  )
);

const provider = new ethers.JsonRpcProvider(RPC);

const [network, balance, feeData] = await Promise.all([
  provider.getNetwork(),
  provider.getBalance(WALLET),
  provider.getFeeData()
]);

const gas = await provider.estimateGas({
  from: WALLET,
  data: artifact.bytecode
});

const gasPrice = feeData.gasPrice;
const estimatedCost = gas * gasPrice;

console.log("Chain ID:", network.chainId.toString());
console.log("EVM wallet:", WALLET);
console.log("Balance:", ethers.formatEther(balance), "tPOT");
console.log("Bytecode size:", (artifact.bytecode.length - 2) / 2, "bytes");
console.log("Estimated gas:", gas.toString());
console.log("Gas price:", gasPrice.toString());
console.log("Estimated deployment cost:", ethers.formatEther(estimatedCost), "tPOT");
console.log("Balance after estimate:", ethers.formatEther(balance - estimatedCost), "tPOT");

await provider.destroy();