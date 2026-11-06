# Milestone Grants — Portaldot Hacker House (Ecosystem DApps)

Transparent, enforceable milestone funding on Portaldot. The Foundation's support program releases resources
"based on milestone review"; this puts that mechanism on-chain.

**Flow:** a funder locks POT (or any ERC-20) against ordered milestones → the recipient claims each milestone by
anchoring the **git commit** that delivers it (20-byte SHA-1 + evidence URL) → an **M-of-N reviewer panel** approves →
at the threshold the milestone's funds release automatically → after the deadline the funder reclaims whatever is
unreleased.

**Evidence is real:** the web app verifies each anchored commit live against GitHub's public API and shows the
commit message, author and whether it was authored *before or after* the grant was created.

## Architecture

See [Product Architecture](docs/architecture.md) for the system overview, components and deployment status.

## Demo Video

[Watch the MilestoneGrants Demo](https://youtu.be/jUMyjCzC1kg)

The video demonstrates the MilestoneGrants prototype and its core grant lifecycle.

## Contract: `contracts/MilestoneGrants.sol`
- `createGrant(CreateParams)` payable — native or ERC-20 (via `transferFrom`), accounts passed as 32-byte AccountId32 values, ≤10 reviewers, ≤10 milestones, M-of-N threshold
- `claimMilestone(id, index, commit, evidence)` — recipient only, in order, before the deadline
- `approveMilestone(id, index)` — reviewers only, one vote each, auto-release at threshold
- `reclaim(id)` — funder only, after the deadline, refunds `total - released`
- Reentrancy guard, checks-effects-interactions, custom errors, events for every state change
- Not in scope: reviewer rejection votes (a stalled claim is resolved by the deadline + `reclaim`), governance tokens, upgradeability

## Web app (Next.js App Router, React, TypeScript)
`app/`, `components/`, `public/config.json`; chain logic in `lib/`. Own dependency-free ABI encoder (`lib/abi.ts`, tested against the Solidity-docs vectors and
cross-checked against ethers). Shows empty/offline states when no registry is configured or the node is unreachable; the real app never fakes data. The simulated chain is a separate route (`/demo`) with its own code.

## Run it
```bash
npm install
npm run dev                      # http://localhost:3000 is the real app, http://localhost:3000/demo is the demo (see below)

npm run test:abi                 # ABI encoder vectors
npm run test:demo                # the demo contract, driven through the app's own encoders
npm run test:separation          # the real app contains and imports no demo code
npm run crosscheck               # encoder == ethers for every UI call
npm run compile && npm run test:contract   # contract tests, in-process, no network
```

## Demo (`/demo`, no node, no wallet, no deployment)
The demo is a separate route with its own code in `demo/` and `app/demo/`. The real app at `/` does not import it, bundle it or read its
state (`npm run test:separation` enforces this). Both routes share only the screen, `components/GrantsApp.tsx`, which is driven by a small
`Mode` object: the real one is built in `app/page.tsx`, the demo one in `demo/mode.tsx`.

In the demo the app runs against a simulated copy of the contract that lives in the browser tab (`demo/contract.ts`). It is fed the same
calldata the real contract takes and applies the same rules (ordered claims, one vote per reviewer, M-of-N release, reclaim after the
deadline), so the UI code path is the production one.
- A banner says it is a demo and links to the real app; "Reset demo" restores the seed data.
- Log in as Funder, Builder or one of three Reviewers, and switch from the bar at the top. The demo login is stored under its own key (`mg-demo-session`) and never becomes a real login.
- Two grants are seeded: one fresh (the Builder claims milestone 1) and one past its deadline (the Funder reclaims).
- "Fill with an example" on the New grant form fills a ready grant.
- The GitHub commit check is real. Set `DEMO_REPO` in `demo/repo.ts` to your repository and claim with one of its real commit SHAs.
- Paying in a token is not available in the demo.

## Deploy to the Portaldot V3 testnet
The contract is deployed as a native PolkaVM contract: `scripts/compile-pvm.mjs` builds it with Parity's `resolc`, and a Substrate account signs
`revive.instantiateWithCode`. Reads are `reviveApi.call` dry runs, writes are `revive.call` extrinsics.
```bash
npm install
npm run test:contract                                       # 17 contract tests, in-process, no network
KEYSTORE_FILE=./my-account.json npm run deploy:portaldot    # asks for the password, then for a final "y"
npm run check:registry                                      # read-only: the deployed registry answers grantCount()
```
Everything before the final "y" is read-only and free: the script compiles fresh, checks the account mapping against the chain, and dry-runs the
deployment on the chain. If the chain would reject the contract, it prints the exact reason (for example `revive.BlobTooLarge`) and sends nothing.
After a successful deploy it sets `registry` in `public/config.json`; commit that file.

**Activate your account.** A contract pays a 20-byte address, and the chain turns that back into an account only if the account has registered
itself once (`revive.mapAccount`). Otherwise a payout lands in a placeholder account nobody holds the key to. The app therefore shows an
**Activate account** button for any logged-in account that has not done this, and refuses to create a grant if the funder or the recipient has not.
Everyone who will receive money (funders for refunds, builders for payouts) activates once, with a small refundable deposit.

`public/config.json`: `wsUrl` (`wss://test-node-v3.portaldot.dev`), `registry` (the contract's account as a `5…` address), `nativeSymbol`, `nativeDecimals`, `ss58Format`.

## Login (Portaldot Substrate accounts, address starts with 5)
Three ways in, all giving the same account type: browser extension (desktop, or Orion on mobile), keystore JSON + password, and the account info JSON alongside the keystore. Keys are decrypted in the browser only. Writes are signed as `revive.call` extrinsics (Portaldot V3 runs pallet-revive), after a `reviveApi.call` dry run for weight and deposit limits. A `5…` account acts on the contract as the address keccak256(publicKey)[12..].
Recipients, reviewers and tokens are entered as `5…` addresses; the contract takes and returns them as 32-byte account ids (`bytes32`) and derives the 20-byte address its payments need with the same rule pallet-revive uses (Ethereum-derived accounts, including contracts, use the first 20 bytes; every other account uses the last 20 bytes of `keccak256(accountId)`). The funder id in `createGrant` is checked against the caller, so ids cannot be faked. The app never shows or accepts `0x…` addresses. A token is entered as the `5…` form of its contract account.

## Portaldot V3 Testnet Deployment Status

Network: Portaldot V3 Testnet
Chain ID: 420420777
RPC: https://test-evm-rpc-v3.portaldot.dev
WebSocket: wss://test-node-v3.portaldot.dev

Status: Contract deployment pending.

The contract compiles to a native PolkaVM blob. An earlier instantiation attempt failed in the dry run with error `0x17000000`; no deployment transaction was submitted. The deploy script now compiles with `resolc` and prints the decoded reason for any dry-run failure.

## Development History

See [Development Log](docs/development-log.md) for a summary of implementation progress.

[View complete GitHub commit history](https://github.com/orjinameh/milestone-grants/commits/main).

## Disclosure
Runtime: Next.js and React only; the contract client has no third-party code. Dev tooling: Hardhat, ethers, TypeScript, tsx. Built with AI assistance (Claude).
License: MIT
