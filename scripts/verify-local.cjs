const hre = require("hardhat");

async function main() {
  const address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const wallet = "0xf3a73e7fa1b01f0f77970fa81e922bac589b64a4";

  const code = await hre.ethers.provider.getCode(address);
  const contract = await hre.ethers.getContractAt("MilestoneGrants", address);

  console.log("Contract deployed:", code !== "0x");
  console.log("Contract address:", address);
  console.log("Grant count:", (await contract.grantCount()).toString());
  console.log("Wallet balance:", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(wallet)
  ), "ETH");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
