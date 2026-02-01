#!/bin/bash
# Deploy Solana Programs to Mainnet
# Prerequisites: Rust, Solana CLI, Anchor, sufficient SOL for deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROGRAMS_DIR="$ROOT_DIR/programs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Solana Privacy Trading Deployment ===${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v rustc &> /dev/null; then
    echo -e "${RED}Rust not installed. Install with: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
    exit 1
fi

if ! command -v solana &> /dev/null; then
    echo -e "${RED}Solana CLI not installed. Install with: sh -c \"\$(curl -sSfL https://release.anza.xyz/stable/install)\"${NC}"
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}Anchor not installed. Install with: cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install latest && avm use latest${NC}"
    exit 1
fi

echo -e "${GREEN}All prerequisites met!${NC}"
echo ""

# Check Solana config
echo -e "${YELLOW}Checking Solana configuration...${NC}"
SOLANA_CLUSTER=$(solana config get | grep "RPC URL" | awk '{print $3}')
echo "Current cluster: $SOLANA_CLUSTER"

if [[ "$SOLANA_CLUSTER" != *"mainnet"* ]]; then
    echo -e "${YELLOW}Warning: Not on mainnet. To switch: solana config set --url https://api.mainnet-beta.solana.com${NC}"
    read -p "Continue with current cluster? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check wallet balance
WALLET_ADDRESS=$(solana address)
BALANCE=$(solana balance --lamports | awk '{print $1}')
MIN_BALANCE=5000000000  # 5 SOL minimum for deployment

echo "Wallet: $WALLET_ADDRESS"
echo "Balance: $(solana balance)"

if [ "$BALANCE" -lt "$MIN_BALANCE" ]; then
    echo -e "${RED}Insufficient balance. Need at least 5 SOL for deployment.${NC}"
    exit 1
fi

echo ""

# Build programs
echo -e "${YELLOW}Building programs...${NC}"
cd "$PROGRAMS_DIR"

# Build ZK Verifier
echo "Building zk-verifier..."
cd zk-verifier
anchor build
cd ..

# Build Privacy Trading
echo "Building privacy-trading..."
cd privacy-trading
anchor build

# Build encrypted instructions if Arcium CLI available
if command -v arcium &> /dev/null; then
    echo "Building Arcium encrypted instructions..."
    cd encrypted-ixs
    arcium build
    cd ..
fi
cd ..

echo -e "${GREEN}Build complete!${NC}"
echo ""

# Deploy programs
echo -e "${YELLOW}Deploying programs...${NC}"

# Deploy ZK Verifier
echo "Deploying zk-verifier..."
ZK_VERIFIER_ID=$(anchor deploy --program-name zk_verifier 2>&1 | grep "Program Id:" | awk '{print $3}')
echo -e "${GREEN}ZK Verifier deployed: $ZK_VERIFIER_ID${NC}"

# Deploy Privacy Trading
echo "Deploying privacy-trading..."
PRIVACY_TRADING_ID=$(anchor deploy --program-name privacy_trading 2>&1 | grep "Program Id:" | awk '{print $3}')
echo -e "${GREEN}Privacy Trading deployed: $PRIVACY_TRADING_ID${NC}"

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "ZK Verifier Program ID: $ZK_VERIFIER_ID"
echo "Privacy Trading Program ID: $PRIVACY_TRADING_ID"
echo ""
echo "Update your .env file with:"
echo "ZK_VERIFIER_PROGRAM_ID=$ZK_VERIFIER_ID"
echo "PRIVACY_TRADING_PROGRAM_ID=$PRIVACY_TRADING_ID"
echo ""
echo "Explorer links:"
echo "https://solscan.io/account/$ZK_VERIFIER_ID"
echo "https://solscan.io/account/$PRIVACY_TRADING_ID"
