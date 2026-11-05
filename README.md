# Milestone Grants — Portaldot Hacker House (Ecosystem DApps)

Transparent, enforceable milestone funding on Portaldot. The Foundation's support program releases resources
"based on milestone review"; this puts that mechanism on-chain.

**Flow:** a funder locks POT (or any ERC-20) against ordered milestones → the recipient claims each milestone by
anchoring the **git commit** that delivers it (20-byte SHA-1 + evidence URL) → an **M-of-N reviewer panel** approves →
at the threshold the milestone's funds release automatically → after the deadline the funder reclaims whatever is
unreleased.

**Evidence is real:** the web app verifies each anchored commit live against GitHub's public API and shows the
commit message, author and whether it was authored *before or after* the grant was created.

## Contract: `contracts/MilestoneGrants.sol`
- `createGrant(CreateParams)` payable — native or ERC-20 (via `transferFrom`), ≤10 reviewers, ≤10 milestones, M-of-N threshold
- `claimMilestone(id, index, commit, evidence)` — recipient only, in order, before the deadline
- `approveMilestone(id, index)` — reviewers only, one vote each, auto-release at threshold
- `reclaim(id)` — funder only, after the deadline, refunds `total - released`
- Reentrancy guard, checks-effects-interactions, custom errors, events for every state change
- Not in scope: reviewer rejection votes (a stalled claim is resolved by the deadline + `reclaim`), governance tokens, upgradeability

## Web app (`web/`, `src/lib/`)
Static, dependency-free TypeScript. Own ABI encoder (`src/lib/abi.ts`, tested against the Solidity-docs vectors and
cross-checked against ethers). Shows empty/offline states when no registry is configured or the RPC is unreachable; never fake data.

## Run it
```bash
npm install
npm run test:abi                 # ABI encoder vectors
npm run crosscheck               # encoder == ethers for every UI call
npm run compile && npm run test:contract

export DEPLOYER_PRIVATE_KEY=0x…  # TESTNET-ONLY key funded with POT
npm run deploy:portaldot         # writes deployment.json and sets web/config.json registryAddress
npm run build:web && npm run serve:web   # http://localhost:8080
```
Network: chain ID `420420777`, EVM RPC `https://test-evm-rpc-v3.portaldot.dev`.

## Disclosure
No third-party runtime code. Dev tooling: Hardhat, ethers, TypeScript, tsx. Built with AI assistance (Claude).
License: MIT
