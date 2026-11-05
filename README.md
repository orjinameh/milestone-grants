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

## Web app (Next.js App Router, React, TypeScript)
`app/`, `components/`, `public/config.json`; chain logic in `lib/`. Own dependency-free ABI encoder (`lib/abi.ts`, tested against the Solidity-docs vectors and
cross-checked against ethers). Shows empty/offline states when no registry is configured or the RPC is unreachable; never fake data.

## Run it
```bash
npm install
npm run test:abi                 # ABI encoder vectors
npm run crosscheck               # encoder == ethers for every UI call
npm run compile && npm run test:contract

export DEPLOYER_PRIVATE_KEY=0x…  # TESTNET-ONLY key funded with POT
npm run deploy:portaldot         # writes deployment.json and sets public/config.json registryAddress
npm run dev                      # http://localhost:3000  (or `npm run build && npm start`)
```
Network: chain ID `420420777`, EVM RPC `https://test-evm-rpc-v3.portaldot.dev`.

## Login (Portaldot Substrate accounts, address starts with 5)
Three ways in, all giving the same account type: browser extension (desktop, or Orion on mobile), keystore JSON + password, and the account info JSON alongside the keystore. Keys are decrypted in the browser only. Writes are signed as `revive.call` extrinsics (Portaldot V3 runs pallet-revive), after a `reviveApi.call` dry run for weight and deposit limits. A `5…` account acts on the contract as the address keccak256(publicKey)[12..].
`public/config.json` holds `wsUrl` (`wss://test-node-v3.portaldot.dev`). Recipients and reviewers may be entered as `5…` or `0x…`.

## Disclosure
Runtime: Next.js and React only; the contract client has no third-party code. Dev tooling: Hardhat, ethers, TypeScript, tsx. Built with AI assistance (Claude).
License: MIT
