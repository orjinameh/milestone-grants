require("@nomicfoundation/hardhat-toolbox");
module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" } },
  networks: {
    portaldot: {
      url: process.env.PORTALDOT_EVM_RPC || "https://test-evm-rpc-v3.portaldot.dev",
      chainId: 420420777,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  paths: { sources: "contracts", tests: "test" },
};
