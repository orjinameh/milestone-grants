require("@nomicfoundation/hardhat-toolbox");
// Settings other Portaldot V3 builders use: small code matters because deployed code is capped (~10 KB) and deposits scale with size.
module.exports = {
  solidity: { version: "0.8.24", settings: { viaIR: true, optimizer: { enabled: true, runs: 1 }, evmVersion: "cancun" } },
  paths: { sources: "contracts", tests: "test" },
};
