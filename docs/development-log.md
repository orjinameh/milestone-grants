# MilestoneGrants — Development Log

This document records the development progress of MilestoneGrants during November 5–6, 2026, based on the repository's Git commit history.

## November 5, 2026

### Initial implementation
- Initial project repository setup.
- Developed the Solidity MilestoneGrants escrow contract with commit evidence and M-of-N reviewer approval.
- Implemented ABI encoding, contract call builders and GitHub commit verification with tests.
- Built grant creation, milestone claiming, approval and fund reclamation interfaces.
- Added project README and setup documentation.

### Frontend development
- Migrated the frontend to Next.js App Router.
- Refactored the library directory structure.
- Redesigned the interface with a milestone release rail, commit evidence indicators and guided grant creation.
- Improved responsive layouts across screen sizes.

### Wallet and blockchain integration
- Implemented Portaldot Substrate wallet login using browser extensions and keystore files.
- Added support for JSON-based account login and automatic extension account connection.
- Improved wallet session persistence and recovery from stale application chunks.
- Added wallet address copying.
- Fixed production chunk-loading and minification issues.
- Added a custom Substrate deployment script using Portaldot's Revive pallet.

### Deployment investigation
- Attempted contract deployment to Portaldot V3 Testnet.
- Investigated chain-read failures and added validation for missing contract responses.
- Documented the testnet deployment blocker and updated deployment tooling.

## November 6, 2026

### Account and network handling
- Updated account handling to use Substrate account identifiers in the contract.
- Improved display of Substrate addresses and documentation of EVM address mapping.

### Demo and documentation
- Added browser-based demo mode and removed leftover EVM-specific functionality.
- Updated the demo repository configuration.
- Added product architecture documentation.
- Linked the architecture documentation from the main README.

## Current Development Status

- Solidity contract: Developed and successfully compiled.
- Frontend prototype: Implemented.
- Browser demo mode: Implemented.
- GitHub commit verification: Implemented with tests.
- Portaldot Substrate wallet integration: Implemented.
- Portaldot V3 deployment: Pending successful instantiation.
- Live on-chain grant lifecycle: Not yet verified.

## Deployment Blocker

The initial deployment attempt reached the contract instantiation dry-run stage but returned error `0x17000000`. The deployment transaction was not submitted during that attempt.

The team has requested testnet funding assistance from Portaldot administrators and is still working to resolve the deployment issue.

## Development Evidence

The complete development history is publicly

### Demo separated from the real app
- Moved the simulated chain to `/demo` (`demo/`, `app/demo/`); the real app at `/` no longer contains demo code.
- Extracted the shared screen into `components/GrantsApp.tsx`, driven by a `Mode` object. Demo and real logins use different storage keys.
- Added `npm run test:separation` to keep the two apart.
