const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying with:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("MilestoneGrants");
  const contract = await Factory.deploy();

  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("CONTRACT_ADDRESS:", address);
  console.log("CHAIN_ID:", (await hre.ethers.provider.getNetwork()).chainId.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
