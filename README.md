# Cobot

![Solana](https://img.shields.io/badge/Solana-black?style=flat&logo=solana&logoColor=14F195)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)
![Noir](https://img.shields.io/badge/Noir-000000?style=flat&logo=aztec&logoColor=white)
![Zero Knowledge](https://img.shields.io/badge/ZK-Proofs-purple?style=flat)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

> **Privacy-preserving prediction markets and AI agents on Solana.** Trade on DFlow/Kalshi markets without linking your wallet to your positions using zero-knowledge proofs, shielded pools, and MPC encryption.

---

## 🎥 Presentation

**Video:** [https://youtu.be/41KW9wp7x9I](https://youtu.be/41KW9wp7x9I)

---

## 🏁 Track

**Privacy Track** - Solana Privacy Hackathon

Building privacy infrastructure for prediction markets and autonomous trading agents using ZK proofs, shielded pools, and compliant cross-chain transfers.

---

## 🏆 Sponsor Bounties Targeted

| Sponsor | Bounty | Prize Pool | Our Integration |
|---------|--------|------------|-----------------|
| **Radr Labs** | Private Transfers with ShadowWire | $15,000 | ZK shielded transfers using Bulletproof range proofs for wallet unlinkability ([backend/src/services/shadowwire.ts](backend/src/services/shadowwire.ts)) |
| **Privacy Cash** | Best Integration to Existing App | $15,000 | shielded pool transfers ([backend/src/services/privacy-cash.ts](backend/src/services/privacy-cash.ts)) |
| **Arcium** | End-to-End Private DeFi | $10,000 | MPC encryption for Agent strategies, questions & more - client-side x25519 encryption, encrypted batch execution, on-chain verification ([backend/src/services/arcium-client.ts](backend/src/services/arcium-client.ts), [frontend/src/lib/arcium-encrypt.ts](frontend/src/lib/arcium-encrypt.ts)) |
| **Aztec** | ZK with Noir | $10,000 | Noir ZK circuits for AI agent response verification - proves AI responses are generated from actual queries without tampering ([backend/circuits/ai_response_verifier/src/main.nr](backend/circuits/ai_response_verifier/src/main.nr), [backend/src/services/noir-prover.ts](backend/src/services/noir-prover.ts)) |
| **SilentSwap** | Private Cross-Chain Transfers | $5,000 | Privacy-preserving cross-chain bridge for Solana ↔ EVM transfers with no on-chain link ([backend/src/services/silentswap.ts](backend/src/services/silentswap.ts)) |
| **Helius** | Best Privacy Project with Helius | $5,000 | Primary RPC provider for high-performance Solana connectivity ([backend/src/services/rpc-provider.ts](backend/src/services/rpc-provider.ts)) |
| **Starpay** | Privacy-Focused Payments | $3,500 | Prepaid Visa/Mastercard issuance for cashing out trading winnings to physical cards ([backend/src/routes/cards.ts](backend/src/routes/cards.ts), [frontend/src/components/cards/CardOrder.tsx](frontend/src/components/cards/CardOrder.tsx)) |
| **Quicknode** | Public Benefit Prize | $3,000 |  RPC provider in multi-provider failover system for high availability ([backend/src/services/rpc-provider.ts](backend/src/services/rpc-provider.ts)) |
| **Range** | Compliant Privacy | $1,500+ | OFAC/AML pre-screening before all privacy transfers to ensure compliance ([backend/src/services/range.ts](backend/src/services/range.ts)) |

---

## 📬 Contact

**Telegram:** @cobotgg

---

## 🗺️ Roadmap

### Phase 1: Hackathon (Current)
- ✅ ShadowWire ZK shielded transfers integration
- ✅ SilentSwap privacy cross-chain bridge
- ✅ Range Protocol OFAC/AML compliance screening
- ✅ DFlow prediction markets trading
- ✅ Privacy pool architecture for wallet unlinkability
- ✅ Multi-provider bridge comparison (LI.FI + SilentSwap)

### Phase 2: Post-Hackathon
- 🔄 Integrate Privacy infra on our prediction markets app cobot 
- 🔄 Get initial feedback and traction 
- 🔄 Expand to privacy first Multi-chain prediction markets (Base, Polygon, BNB Chain)


### Phase 3: Future Vision
- 📋 x402 + ERC 8004 Agents for prediction markets 
- 📋 SDK for third-party integrations

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Sponsor Integrations](#sponsor-integrations)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Cobot** is a privacy-first prediction market trading platform that enables users to trade without revealing their wallet identity or position sizes. We integrate multiple privacy technologies to create a complete privacy layer for Solana prediction markets and Autonomous trading agents

### The Problem

Traditional prediction market trading exposes your entire trading history on-chain:

- Your wallet address is linked to every position
- Order sizes reveal your conviction and strategy
- Competitors can front-run or copy your trades
- No financial privacy for legitimate traders

### The Solution

Cobot provides a complete privacy stack that breaks all on-chain links:

| Feature | Technology | Benefit |
|---------|------------|---------|
| **ZK Shielded Transfers** | ShadowWire | Deposit/withdraw without linking wallets |
| **Cross-Chain Privacy** | SilentSwap | Bridge to EVM with privacy routing |
| **Compliance Screening** | Range Protocol | OFAC-cleared transactions |
| **Anonymous Trading** | Privacy Pools | Trade from wallets with no history |

---

## Features

### Privacy Trading
- **Shielded Pools**: Deposit funds to ZK-protected pools, withdraw to fresh wallets
- **Bulletproof Range Proofs**: Cryptographic verification without revealing amounts
- **Wallet Unlinkability**: No on-chain connection between source and trading wallets

### Cross-Chain Bridge
- **Multi-Provider Support**: LI.FI for best rates, SilentSwap for privacy routing
- **Supported Chains**: Solana, Ethereum, Base, Polygon, Arbitrum
- **Token Support**: SOL, USDC, ETH, and 20+ tokens

### Prediction Markets
- **DFlow Integration**: Access to Kalshi prediction markets powered by Dflow
- **AI-Powered Research**: Natural language market analysis
- **Position Management**: Track and manage all positions

### Compliance
- **Range Protocol**: Pre-transaction OFAC/AML screening
- **Risk Scoring**: Low/Medium/High/Severe risk classification
- **Automatic Blocking**: Prevents transactions with sanctioned addresses

---

## Architecture

```
                                 COBOT ARCHITECTURE

    ┌─────────────────────────────────────────────────────────────────┐
    │                     FRONTEND (React + Vite)                     │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
    │  │   Phantom    │  │   Markets    │  │   Privacy    │          │
    │  │   Connect    │  │   Browser    │  │   Controls   │          │
    │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
    └─────────┼─────────────────┼─────────────────┼──────────────────┘
              │                 │                 │
              └─────────────────┴─────────────────┘
                                │
                                ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                  BACKEND API (Express + TypeScript)             │
    ├─────────────────────────────────────────────────────────────────┤
    │                                                                 │
    │  ┌─────────────────────────────────────────────────────────┐   │
    │  │                   SPONSOR INTEGRATIONS                   │   │
    │  ├─────────────────────────────────────────────────────────┤   │
    │  │                                                         │   │
    │  │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │   │
    │  │  │ ShadowWire  │   │    LI.FI    │   │    Range    │   │   │
    │  │  │ ZK Proofs   │   │   Bridge    │   │ Compliance  │   │   │
    │  │  │ (Radr Labs) │   │             │   │             │   │   │
    │  │  └─────────────┘   └─────────────┘   └─────────────┘   │   │
    │  │                                                         │   │
    │  │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │   │
    │  │  │ SilentSwap  │   │   DFlow     │   │   Phantom   │   │
    │  │  │Privacy Route│   │  Markets    │   │   Connect   │   │   │
    │  │  └─────────────┘   └─────────────┘   └─────────────┘   │   │
    │  │                                                         │   │
    │  └─────────────────────────────────────────────────────────┘   │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                      SOLANA BLOCKCHAIN                          │
    │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
    │  │  Shielded   │   │    DFlow    │   │   User      │           │
    │  │   Pools     │   │  Orderbook  │   │  Wallets    │           │
    │  └─────────────┘   └─────────────┘   └─────────────┘           │
    └─────────────────────────────────────────────────────────────────┘
```

### Privacy Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  User Wallet │────►│    Range     │────►│  ShadowWire  │
│   (Source)   │     │  Compliance  │     │  ZK Pool     │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                          ZK Range Proof ─────────┤
                          (Amount hidden)         │
                                                  ▼
                                          ┌──────────────┐
                                          │Trading Wallet│
                                          │ (Anonymous)  │
                                          └──────┬───────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    DFlow     │◄────│   Execute    │◄────│   Manage     │
│   Markets    │     │    Trade     │     │  Positions   │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## Sponsor Integrations

### ShadowWire (Radr Labs) - ZK Private Transfers

ShadowWire enables wallet unlinkability through ZK shielded pools using Bulletproof range proofs.

**How It Works:**

1. **Deposit**: User deposits funds to a shielded pool (on-chain)
2. **ZK Proof**: Client generates a Bulletproof range proof (proves amount is valid without revealing it)
3. **External Transfer**: Funds move from pool to destination wallet (no on-chain link to sender)

**Integration Code:**

```typescript
import { ShadowWireClient, TokenUtils, initWASM, generateRangeProof } from '@radr/shadowwire';

// Initialize client
const client = new ShadowWireClient({
  network: 'mainnet-beta',
  debug: false,
});

// Execute private transfer using high-level API
const result = await client.transfer({
  sender: sourceWallet,
  recipient: destinationWallet,
  amount: 1.5,        // SOL amount
  token: 'SOL',
  type: 'external',   // External = pool -> any wallet
  wallet: walletAdapter,
});

// Result includes tx signature, amount is hidden on-chain
console.log('Transfer:', result.tx_signature);
console.log('Amount hidden:', result.amount_hidden); // true
```

**Supported Tokens:** SOL, USDC, RADR, BONK, and 20+ SPL tokens

**Fees:** 0.3% - 2% depending on token

---

### SilentSwap - Privacy Cross-Chain Bridge

SilentSwap provides privacy-preserving cross-chain transfers that break the link between source and destination chains.

**How It Works:**

1. **Initiate**: Send funds from source chain
2. **Privacy Mixing**: Funds are mixed with other transfers
3. **Deliver**: Receive on destination chain from different source

**Integration:**

SilentSwap is available as an alternative provider in the bridge module. Select "SilentSwap" for maximum privacy or "LI.FI" for best rates.

```typescript
// Multi-provider swap endpoint
const swap = await fetch('/api/bridge/multi/swap', {
  method: 'POST',
  body: JSON.stringify({
    provider: 'silentswap', // or 'lifi'
    fromChain: 'solana',
    toChain: 'base',
    fromToken: 'SOL',
    toToken: 'ETH',
    amount: 1.5,
    fromAddress: solanaWallet,
    toAddress: evmAddress,
  }),
});
```

---

### Range Protocol - Compliance Screening

Range provides OFAC/AML pre-transaction screening to ensure compliant privacy.

**How It Works:**

1. **Screen Addresses**: Check both source and destination before transaction
2. **Risk Scoring**: Receive risk level (Low/Medium/High/Severe)
3. **Block/Allow**: Automatically block sanctioned addresses

**Integration Code:**

```typescript
import { screenTransaction, shouldBlockTransaction } from './services/range';

// Screen addresses before transfer
const screening = await screenTransaction(
  fromAddress,
  toAddress,
  amount,
  'SOL',
  'solana'
);

// Check if transaction should proceed
if (shouldBlockTransaction(screening)) {
  throw new Error(`Blocked: ${screening.reason}`);
}

// Proceed with transaction
console.log('Risk level:', screening.overallRisk);
console.log('Recommendation:', screening.recommendation);
```

**Risk Levels:**

| Level | Action | Description |
|-------|--------|-------------|
| Low | Allow | Address has clean history |
| Medium | Review | Some concerning patterns |
| High | Review | Multiple risk factors |
| Severe | Block | Sanctioned or high-risk |

---

### Phantom Connect SDK - Wallet Integration

Phantom SDK provides secure, non-custodial wallet connection for Solana.

**How It Works:**

1. **Connect**: User approves connection in Phantom
2. **Sign**: Transactions are signed client-side
3. **Submit**: Signed transactions submitted to network

**Integration Code:**

```typescript
import { usePhantom, AddressType } from '@phantom/react-sdk';

function WalletConnect() {
  const { addresses, isConnected, connect } = usePhantom();

  const solanaAddress = addresses.find(
    addr => addr.addressType === AddressType.solana
  )?.address;

  return (
    <button onClick={connect}>
      {isConnected ? `Connected: ${solanaAddress}` : 'Connect Wallet'}
    </button>
  );
}
```

---

### DFlow - Prediction Markets

DFlow provides access to Kalshi prediction markets on Solana.

**How It Works:**

1. **Browse Markets**: Fetch active prediction markets
2. **Get Quotes**: Check prices for YES/NO positions
3. **Trade**: Execute orders on the orderbook

**Integration Code:**

```typescript
// Fetch active markets
const markets = await fetch('/api/markets');

// Get market details with current prices
const market = await fetch(`/api/markets/${marketId}`);

// Place an order
const order = await fetch('/api/trading/order', {
  method: 'POST',
  body: JSON.stringify({
    marketId: 'market-123',
    side: 'yes',
    amount: 10,          // USDC
    maxPrice: 0.65,      // 65 cents per share
    walletId: 'trading-wallet-id',
  }),
});
```

---

## Installation

### Prerequisites

- **Node.js** 18.0 or higher
- **npm** or **pnpm** package manager
- **Phantom Wallet** browser extension
- **Solana CLI** (optional, for contract verification)

### Clone Repository

```bash
git clone https://github.com/your-org/cobot.git
cd cobot
```

### Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

# Install ShadowWire SDK (local)
cd ../ShadowWire
npm install
npm run build
```

### Build Project

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd ../frontend
npm run build
```

---

## Configuration

### Environment Setup

Copy the example environment file and configure:

```bash
cp backend/.env.example backend/.env
```

### Required Variables

```env
# ===========================================
# CORE CONFIGURATION
# ===========================================

# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Solana RPC (use Alchemy, Helius, or QuickNode)
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY

# Main Wallet (base58 encoded private key)
MAIN_WALLET_PRIVATE_KEY=your_base58_private_key_here

# USDC Mint Address (mainnet)
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

### Privacy & Bridge Variables

```env
# ===========================================
# PRIVACY INTEGRATIONS
# ===========================================

# ShadowWire (Radr Labs) - ZK Transfers
SHADOWWIRE_ENABLED=true

# LI.FI Cross-Chain Bridge
LIFI_INTEGRATOR=cobot-privacy-trading
LIFI_API_KEY=your_lifi_api_key          # Optional, for higher limits

# Range Compliance - OFAC Screening
RANGE_API_KEY=your_range_api_key        # Optional, enables compliance
```

### Trading Variables

```env
# ===========================================
# TRADING CONFIGURATION
# ===========================================

# DFlow API (Prediction Markets)
DFLOW_API_KEY=your_dflow_api_key
DFLOW_METADATA_API_URL=https://a.prediction-markets-api.dflow.net/api/v1
DFLOW_TRADE_API_URL=https://quote-api.dflow.net/api/v1

# AI Features (Optional)
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4-turbo-preview
```

### Full Environment Example

See [backend/.env.example](backend/.env.example) for complete configuration reference.

---

## Usage

### Start Development Server

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend
cd frontend
npm run dev
```

**Access Points:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- Health Check: http://localhost:3001/health

### Production Deployment

```bash
# Build for production
cd backend && npm run build
cd ../frontend && npm run build

# Start production server
cd backend && npm start
```

### Common Operations

**Check System Health:**
```bash
curl http://localhost:3001/health
```

**View Wallet Info:**
```bash
curl http://localhost:3001/api/wallet
```

**Create Trading Wallet:**
```bash
curl -X POST http://localhost:3001/api/wallet/trading \
  -H "Content-Type: application/json" \
  -d '{"label": "My Trading Wallet"}'
```

**Execute Private Transfer:**
```bash
curl -X POST http://localhost:3001/api/shadowwire/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "source_wallet_address",
    "recipient": "destination_wallet_address",
    "amount": 1.5,
    "token": "SOL"
  }'
```

---

## API Reference

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | System health check |
| `/api/wallet` | GET | Main wallet info |
| `/api/wallet/trading` | GET | List trading wallets |

### Privacy Transfers

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/shadowwire/status` | GET | ShadowWire status |
| `/api/shadowwire/transfer` | POST | Execute ZK transfer |
| `/api/shadowwire/deposit` | POST | Deposit to pool |
| `/api/shadowwire/withdraw` | POST | Withdraw from pool |
| `/api/shadowwire/balance/:wallet` | GET | Pool balance |
| `/api/transfer/recover/pool/:walletId` | POST | Recover stuck funds |

### Cross-Chain Bridge

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bridge/status` | GET | Bridge status |
| `/api/bridge/providers` | GET | Available providers |
| `/api/bridge/multi/quote` | GET | Get quotes from all providers |
| `/api/bridge/multi/swap` | POST | Execute swap with provider |
| `/api/bridge/multi/compare` | GET | Compare provider rates |

### Compliance

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/compliance/screen/address` | GET | Screen single address |
| `/api/compliance/screen/transaction` | POST | Screen full transaction |

### Trading

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/markets` | GET | List active markets |
| `/api/markets/:id` | GET | Market details |
| `/api/trading/order` | POST | Place order |
| `/api/trading/positions` | GET | View positions |

---

## Security

### Sensitive Data Protection

**Never commit these files:**
- `.env` - Contains API keys and private keys
- `backend/data/` - Contains wallet data
- `*.wallet.json` - Wallet exports
- `*.pem`, `*.key` - Cryptographic keys

### Private Key Safety

1. **Use dedicated wallets** - Don't use your main holding wallet
2. **Fund minimally** - Only fund what you need for trading
3. **Export carefully** - Requires typing confirmation phrase
4. **Withdraw first** - Always withdraw before closing wallets

### Recovery Endpoints

If funds get stuck in shielded pools (rare edge case), use recovery endpoints:

```bash
# Scan all wallets for stuck funds
curl http://localhost:3001/api/transfer/pool/scan

# Recover funds from specific wallet
curl -X POST http://localhost:3001/api/transfer/recover/pool/WALLET_ID
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built with support from:

- **Solana Foundation** - Privacy Hackathon
- **Radr Labs** - ShadowWire ZK shielded transfers with Bulletproof range proofs
- **Privacy Cash** - Light Protocol compressed transactions for privacy pools
- **Arcium** - MPC encryption for confidential order execution
- **Aztec** - Noir ZK circuits for AI agent response verification
- **SilentSwap** - Privacy-preserving cross-chain bridge
- **Helius** - High-performance Solana RPC
- **Quicknode** - RPC failover infrastructure
- **Starpay** - Prepaid card issuance for cashouts
- **Range** - OFAC/AML compliance screening
- **Phantom** - Wallet SDK integration
- **DFlow** - Prediction market access

---

**Built for the Solana Privacy Hackathon**

*Enabling truly private prediction market trading with compliant, multi-chain architecture.*
