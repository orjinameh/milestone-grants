# Milestone Grants — Portaldot Hacker House (Ecosystem DApps)

Transparent, on-chain milestone funding on Portaldot V3.

Milestone Grants turns milestone-based grant funding into an enforceable smart-contract workflow. A funder locks native POT or an ERC-20 token against an ordered set of milestones. The recipient submits a milestone claim with a Git commit reference and evidence URL. An M-of-N reviewer panel evaluates the submission, and reaching the approval threshold automatically releases the corresponding funds. After the grant deadline, the funder can reclaim the unreleased balance.

**Important design distinction:** GitHub verification is an off-chain evidence-assessment feature in the web application. It does not independently authorize or block contract execution. Reviewers make the approval decision, and the smart contract enforces the configured approval threshold and payment rules.

## Live Test: Repository Typo and Continued Execution

A live Portaldot V3 test demonstrated the separation between GitHub verification and on-chain execution.

The funder created a grant using the repository name `Orjinameh/milestone-grant`, while the intended repository was `orjinameh/milestone-grants`.

- GitHub verification could not find the submitted commit in the supplied repository.
- The application reported the verification failure.
- The reviewer approval process remained available.
- Reviewers approved both milestones.
- The contract emitted approval and release events for both milestones.
- The recipient received two payments of 4 tPOT, totalling 8 tPOT.

This demonstrates that a repository-reference error does not automatically prevent a milestone from being approved and paid. It also highlights an important limitation: the contract does not independently establish that a submitted Git commit exists or that its contents satisfy the milestone. That assessment remains part of the off-chain review process.

## Architecture

See [Product Architecture](docs/architecture.md) for the system overview, components and deployment details.

The system consists of:

- **Smart contract:** grant creation, escrow accounting, ordered milestone claims, reviewer approvals, automatic releases and deadline-based reclamation.
- **Web application:** account access, grant creation, milestone submissions, reviewer actions and grant status.
- **GitHub integration:** checks submitted commit references against GitHub's public API and displays available commit metadata.
- **Portaldot V3:** provides the execution environment and on-chain event records.

## Demo Video

[Watch the MilestoneGrants Demo](https://youtu.be/jUMyjCzC1kg)

The video demonstrates the prototype's grant lifecycle and application workflows.

## Smart Contract: `contracts/MilestoneGrants.sol`

The Solidity contract implements the following operations:

- `createGrant(CreateParams)` — creates a funded grant using native POT or an ERC-20 token. Accounts are supplied as 32-byte AccountId32 values. Supports up to 10 reviewers and 10 milestones, with a configurable M-of-N approval threshold.
- `claimMilestone(id, index, commit, evidence)` — allows the designated recipient to claim the next milestone in sequence, before the grant deadline, by submitting a non-zero 20-byte commit reference and an evidence URL.
- `approveMilestone(id, index)` — allows an assigned reviewer to approve a claimed milestone. Each reviewer can vote once per milestone. Reaching the configured threshold automatically releases that milestone's funds.
- `reclaim(id)` — allows the funder to reclaim the unreleased balance after the deadline.

Additional contract properties:

- Reentrancy guard.
- Checks-effects-interactions payment flow.
- Custom errors for invalid parameters, authorization failures and invalid state transitions.
- Events for grant creation, milestone claims, approvals, releases and grant closure.
- Native-token and ERC-20 payment paths.

**Limitations and scope**

- Reviewer rejection votes are not implemented. A claim that does not reach its approval threshold remains unreleased; after the deadline, the funder can reclaim the remaining funds.
- GitHub commit existence and authorship are not verified by the smart contract.
- Governance tokens and contract upgradeability are outside the current scope.

## Web Application

The application uses Next.js App Router, React and TypeScript.

Main application areas:

- `app/` — application routes.
- `components/` — shared interface components.
- `public/config.json` — network and registry configuration.
- `lib/` — contract interaction, account handling, ABI encoding and chain logic.

The contract client includes a dependency-free ABI encoder in `lib/abi.ts`. It is tested against Solidity documentation vectors and cross-checked against ethers.

The real application distinguishes between configured, empty and offline states. It does not substitute simulated contract data when the registry is missing or the network is unavailable.

The simulator is implemented separately under `/demo`.

## Running Locally

```bash
npm install
npm run dev

# Real application:
# http://localhost:3000

# Simulated application:
# http://localhost:3000/demo

npm run test:abi
npm run test:demo
npm run test:separation
npm run crosscheck
npm run compile
npm run test:contract
```

The test commands cover ABI encoding, simulated contract behaviour, separation between demo and production code, encoder cross-checking and in-process contract tests.

## Demo Environment: `/demo`

The demo is a browser-based simulation. It does not require a wallet, network connection or deployed contract.

Its implementation is separated into `demo/` and `app/demo/`. The production route does not import or read demo state; `npm run test:separation` checks this boundary.

Both routes reuse the presentation component `components/GrantsApp.tsx`, driven by a `Mode` interface. The production and demo routes supply different implementations.

The simulator:

- Executes against a simulated contract in the browser.
- Uses the same calldata interface expected by the Solidity contract.
- Models ordered claims, one vote per reviewer, M-of-N approval and deadline-based reclamation.
- Includes a demo banner and a reset function.
- Provides Funder, Builder and Reviewer demo roles.
- Seeds one active grant and one expired grant.
- Supports example grant creation.
- Can check real GitHub commits when `DEMO_REPO` is configured in `demo/repo.ts`.
- Does not simulate ERC-20 payments.

The simulator is for demonstrating application workflows. Its state and transactions are not Portaldot blockchain transactions.

## Portaldot V3 Testnet Deployment

**Status: Deployed and exercised on Portaldot V3 testnet.**

Network: Portaldot V3 Testnet  
EVM chain ID: `420420777`  
EVM RPC: `https://test-evm-rpc-v3.portaldot.dev`  
Substrate WebSocket: `wss://test-node-v3.portaldot.dev`

Deployed MilestoneGrants contract:

`0x93ca24a53ec91488ff7841ac9a00cc0ce7ac82fa`

Deployment evidence:

- Block: `354887`
- Extrinsic: `354887-1`
- Event: `revive(Instantiated)`
- Deployer EVM address: `0xf3a73e7fa1b01f0f77970fa81e922bac589b64a4`
- [Portaldot V3 deployment block](https://scanner-testnet-v3.portaldot.dev/#/blocks/354887)

The contract was deployed through Portaldot's `pallet-revive` environment. The project uses Parity's `resolc` compilation flow for PolkaVM-compatible contract builds.

The deployment event establishes that the contract was instantiated at the address above. The Solidity source in the repository contains the event definitions and logic corresponding to the observed contract events. A formal deployed-bytecode equivalence verification has not been claimed.

### On-chain execution evidence

The following records establish a successful grant creation and two milestone releases.

**Grant creation**

- Block: `354987`
- Extrinsic: `354987-1`
- Grant ID: `0`
- Event: `GrantCreated`
- Contract: `0x93ca24a53ec91488ff7841ac9a00cc0ce7ac82fa`
- Repository recorded: `Orjinameh/milestone-grant`
- [Explorer record](https://scanner-testnet-v3.portaldot.dev/#/extrinsics/354987-1)

**Milestone 1 approval and release**

- Block: `355310`
- Extrinsic: `355310-1`
- Events: `MilestoneApproved`, `MilestoneReleased`
- Payment: `4 tPOT`
- [Explorer block](https://scanner-testnet-v3.portaldot.dev/#/blocks/355310)

**Milestone 2 approval and release**

- Block: `355333`
- Extrinsic: `355333-1`
- Events: `MilestoneApproved`, `MilestoneReleased`
- Payment: `4 tPOT`
- [Explorer block](https://scanner-testnet-v3.portaldot.dev/#/blocks/355333)

Both release transactions contain successful balance-transfer events from the contract's escrow account to the recipient. The combined released amount was 8 tPOT.

These records demonstrate grant creation, reviewer approval, automatic milestone release and recipient payment on the live testnet.

## Deployment and Account Configuration

The deployment tooling includes:

```bash
npm install
npm run test:contract
KEYSTORE_FILE=./my-account.json npm run deploy:portaldot
npm run check:registry
```

The deployment process compiles the contract, checks account mapping and performs a dry run before submitting the deployment operation. The deployment script requires explicit confirmation before sending the transaction.

After deployment, the registry configuration must point to the deployed contract.

The application configuration in `public/config.json` includes:

- `wsUrl`
- `registry`
- `nativeSymbol`
- `nativeDecimals`
- `ss58Format`

### Account Activation and Address Mapping

Portaldot uses Substrate AccountId32 addresses, commonly displayed in SS58 format with a `5` prefix.

The application supports browser-extension accounts and keystore-based account access. Keys are decrypted locally in the browser.

Contract calls are submitted through Portaldot's `revive.call` extrinsics, with `reviveApi.call` dry runs used to estimate execution requirements.

The contract accepts account identifiers as `bytes32` values and derives the corresponding 20-byte EVM address using its `_evm` mapping function.

For Ethereum-derived accounts, including contract accounts, the first 20 bytes are used when the final 12 bytes are `0xEE`. For other AccountId32 values, the last 20 bytes of `keccak256(accountId)` are used.

The funder's supplied AccountId32 is checked against the transaction caller. This prevents a caller from creating a grant while claiming another account as the funder.

Recipients, reviewers and token accounts are represented using their Substrate account identifiers.

Account mapping and activation requirements are handled by the application to ensure that contract payments resolve to accounts capable of receiving funds.

## Development History

See [Development Log](docs/development-log.md) for implementation progress and technical decisions.

[View complete GitHub commit history](https://github.com/orjinameh/milestone-grants/commits/main).

## Disclosure

Runtime: Next.js and React.  
Contract: Solidity compiled for Portaldot's PolkaVM environment.  
Development tooling: Hardhat, ethers, TypeScript and tsx.  
The project was built with AI assistance (Claude).

License: MIT

## Project Links

- **Live application:** https://milestone-grants.vercel.app
- **Repository:** https://github.com/orjinameh/milestone-grants
- **Demo video:** https://youtu.be/jUMyjCzC1kg
- **Deployed contract:** `0x93ca24a53ec91488ff7841ac9a00cc0ce7ac82fa`
- **Portaldot V3 explorer:** https://scanner-testnet-v3.portaldot.dev/
