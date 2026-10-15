# Gas Sponsor Contract

[![CI](https://github.com/kinged007/gas-sponsor-contract/actions/workflows/ci.yml/badge.svg)](https://github.com/kinged007/gas-sponsor-contract/actions/workflows/ci.yml)

> Experimental smart-contract project exploring transaction gas-fee sponsoring.

A generic, DEX-agnostic gas sponsorship contract deployed on BNB Smart Chain (BSC). The contract holds a centralized BNB pool and allows whitelisted callers to execute arbitrary on-chain operations, using the pool's BNB to fund target wallet operations.

## How It Works

The GasSponsor contract is a **generic executor** -- it knows nothing about any specific DEX, swap, or token. All operation logic (swaps, transfers, approvals) is constructed off-chain by an automation engine and passed as encoded calldata to the contract's `execute()` function.

```
[Automation Engine / Master Wallet]
        │
        ├── Constructs encoded calldata off-chain (swap, transfer, approve, etc.)
        │
        ▼
[GasSponsor Contract]
        │
        ├── Checks: Is msg.sender whitelisted? → Revert if not
        ├── Executes: Forwards call to target with optional BNB value
        └── Pays: Sends BNB from its pool to fund the operation
```

This design means:
- Works with **any DEX** (PancakeSwap, Uniswap, etc.)
- Works for **any operation** (token transfers, approvals, bridging, staking)
- New use cases require **zero contract changes**

## Why Both the Master Wallet and Contract Need BNB

There are two separate BNB requirements in this system, each serving a different purpose:

### Master Wallet (Whitelisted Caller) -- Pays Transaction Gas

Every transaction broadcast to the blockchain requires gas. The **master wallet** is the account that sends transactions to the contract (calling `execute()`, `updateWhitelist()`, etc.), so it must hold BNB to cover these network gas fees.

- Typical cost per transaction: ~0.000006 BNB
- This BNB goes to validators, not the contract

### Contract BNB Pool -- Funds Target Wallet Operations

The **contract's BNB pool** is used to send BNB value to target wallets that need it. This is the core of the gas-refund loop:

1. An empty wallet (has tokens but 0 BNB) needs to approve the contract to spend its tokens
2. The master wallet calls `execute(emptyWallet, "0x", 0.001 BNB)` -- the contract sends 0.001 BNB from its pool to the empty wallet
3. The empty wallet now has BNB and can execute `approve()` itself, paying its own gas
4. The master wallet sweeps the remaining BNB back to itself

```
Master Wallet          Contract Pool         Empty Wallet
    │                       │                      │
    │  execute(wallet,      │                      │
    │  0x, 0.001 BNB)       │                      │
    │──────────────────────►│                      │
    │                       │  0.001 BNB           │
    │                       │─────────────────────►│
    │  (pays ~0.000006 BNB  │                      │
    │   in tx gas)          │                      │ Now has BNB
    │                       │                      │ Can do approve()
```

**In summary:**
| | Master Wallet | Contract Pool |
|---|---|---|
| **Pays for** | Transaction gas fees (to validators) | BNB value sent to target wallets |
| **Used when** | Broadcasting any transaction | Executing `execute()` with `value > 0` |
| **Typical amount** | ~0.000006 BNB per tx | Varies (e.g., 0.001 BNB per wallet init) |
| **Replenished by** | User sends BNB to wallet | User sends BNB to contract address |

## Setup

### Prerequisites

- Node.js v18+
- npm

### Install Dependencies

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|---|---|---|
| `PRIVATE_KEY` | Private key of the deployer/master wallet (with `0x` prefix) | Yes |
| `BSCSCAN_API_KEY` | API key from [BscScan](https://bscscan.com/myapikey) for contract verification | Yes |
| `BSC_TESTNET_RPC_URL` | BSC Testnet RPC URL (defaults to public endpoint) | No |
| `BSC_MAINNET_RPC_URL` | BSC Mainnet RPC URL (defaults to public endpoint) | No |

### Generate a New Wallet

```bash
npm run wallet
```

Outputs a new address, private key, and 12-word mnemonic. Copy the `PRIVATE_KEY` into `.env`, then fund the wallet address with BNB.

- Testnet faucet: https://www.bnbchain.org/en/testnet-faucet

## Commands

### Compile

```bash
npm run compile
```

### Test

```bash
# Run all tests (unit + integration)
npm run test

# Run tests with gas usage reporting
npm run test:gas
```

### Deploy

```bash
# Deploy to BSC Testnet
npm run deploy:testnet

# Deploy to BSC Mainnet
npm run deploy:mainnet
```

Both commands automatically wait for 5 block confirmations and attempt source code verification on BscScan.

### Post-Deployment Setup

After deploying, fund the gas pool and whitelist addresses:

```bash
# BSC Testnet
CONTRACT_ADDRESS=0x... WHITELIST_ADDRS=0x...,0x... FUND_AMOUNT_BNB=0.01 \
  npx hardhat run scripts/setup.ts --network bscTestnet

# BSC Mainnet
CONTRACT_ADDRESS=0x... WHITELIST_ADDRS=0x...,0x... FUND_AMOUNT_BNB=0.01 \
  npx hardhat run scripts/setup.ts --network bscMainnet
```

| Environment Variable | Description | Default |
|---|---|---|
| `CONTRACT_ADDRESS` | Deployed GasSponsor contract address | Required |
| `WHITELIST_ADDRS` | Comma-separated addresses to whitelist | Optional |
| `FUND_AMOUNT_BNB` | Amount of BNB to send to the gas pool | `0.01` |

### Validation & Testing on Live Network

```bash
# Run full validation suite (whitelist, execute, emergency withdraw)
CONTRACT_ADDRESS=0x... npx hardhat run scripts/testnet-validation.ts --network bscTestnet

# Run end-to-end gas sponsorship test
CONTRACT_ADDRESS=0x... npx hardhat run scripts/test-gas-sponsor.ts --network bscTestnet
```

### Check Wallet Balance

```bash
npx hardhat run scripts/check-balance.ts --network bscTestnet
npx hardhat run scripts/check-balance.ts --network bscMainnet
```

## Contract Interface

### Admin Functions (Owner Only)

| Function | Description |
|---|---|
| `updateWhitelist(address account, bool status)` | Add or remove a single address from the whitelist |
| `updateWhitelistBulk(address[] accounts, bool[] statuses)` | Add or remove multiple addresses in one transaction. Reverts if array lengths mismatch. |
| `emergencyWithdrawBNB()` | Withdraw the entire BNB balance of the contract to the owner |
| `emergencyWithdrawToken(address token)` | Rescue stuck ERC20 tokens from the contract |

### Execution Function (Whitelisted Only)

```solidity
function execute(
    address to,       // Target contract or EOA address
    bytes calldata data,  // ABI-encoded calldata for the target
    uint256 value     // Amount of BNB (wei) to send along with the call
) external returns (bytes memory result)
```

This is the core function. The whitelisted caller encodes any operation off-chain and passes it here. The contract forwards the call and optionally sends BNB from its pool.

**Examples of what you can encode:**
- ERC20 `transferFrom(targetWallet, recipient, amount)` -- pull tokens from a wallet that approved the contract
- ERC20 `approve(spender, amount)` -- approve a DEX router
- PancakeSwap `exactInputSingle(...)` -- execute a swap
- Any arbitrary contract call

### Receiving BNB

The contract accepts BNB deposits into its gas pool via the `receive()` function. Simply send BNB to the contract address.

## Project Structure

```
gas-sponsor-contract/
├── contracts/
│   ├── GasSponsor.sol          # Main contract
│   └── mocks/
│       ├── MockERC20.sol       # Test token
│       └── MockTarget.sol      # Test target for execute()
├── scripts/
│   ├── deploy.ts               # Deploy + verify
│   ├── setup.ts                # Fund pool + whitelist
│   ├── testnet-validation.ts   # On-chain validation suite
│   ├── test-gas-sponsor.ts     # E2E gas sponsorship test
│   ├── generate-wallet.ts      # Create new wallet
│   └── check-balance.ts        # Check wallet balance
├── test/
│   ├── GasSponsor.test.ts      # 27 unit tests
│   └── Integration.test.ts     # 7 integration tests
├── hardhat.config.ts
├── package.json
├── .env.example
└── .gitignore
```

## Security

- **Whitelist enforcement**: `execute()` reverts immediately if `msg.sender` is not whitelisted -- prevents unauthorized use of the BNB pool
- **Owner controls**: Only the owner can modify the whitelist or withdraw funds
- **Slippage/deadline protection**: Enforced by the off-chain automation engine, not the contract (the contract is operation-agnostic)
- **Emergency exit**: `emergencyWithdrawBNB()` and `emergencyWithdrawToken()` allow the owner to rescue all funds at any time
