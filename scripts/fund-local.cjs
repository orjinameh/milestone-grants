const hre = require("hardhat");

async function main() {
  const [funder] = await hre.ethers.getSigners();
  const recipient = "0xf3a73e7fa1b01f0f77970fa81e922bac589b64a4";

  const tx = await funder.sendTransaction({
    to: recipient,
    value: hre.ethers.parseEther("100")
  });

  await tx.wait();

  console.log("Wallet:", recipient);
  console.log("Funded: 100 local ETH");
  console.log("Transaction:", tx.hash);
  console.log(
    "Balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(recipient))
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
