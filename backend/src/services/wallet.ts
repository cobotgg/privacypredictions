import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';
import { getConnection as getRPCConnection, executeWithFailover, getRPCStatus } from './rpc-provider.js';
import type { WalletInfo, TradingWallet } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_FILE = path.join(__dirname, '../../data/wallets.json');

// Wallet pair structure for privacy trading
export interface WalletPair {
  id: string;
  primaryWallet: TradingWallet;
  batchWallet: TradingWallet;
  createdAt: string;
}

// In-memory storage backed by file persistence
let walletPairs: Map<string, WalletPair> = new Map();
let tradingWallets: Map<string, TradingWallet> = new Map();

// Ensure data directory exists
function ensureDataDir() {
  const dataDir = path.dirname(WALLETS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Load wallets from file on startup
function loadWalletsFromFile() {
  try {
    ensureDataDir();
    if (fs.existsSync(WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf-8'));

      if (data.walletPairs) {
        walletPairs = new Map(Object.entries(data.walletPairs));
      }
      if (data.tradingWallets) {
        tradingWallets = new Map(Object.entries(data.tradingWallets));
      }

      console.log(`Loaded ${walletPairs.size} wallet pairs from storage`);
    }
  } catch (e) {
    console.error('Failed to load wallets from file:', e);
  }
}

// Save wallets to file
function saveWalletsToFile() {
  try {
    ensureDataDir();
    const data = {
      walletPairs: Object.fromEntries(walletPairs),
      tradingWallets: Object.fromEntries(tradingWallets),
    };
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save wallets to file:', e);
  }
}

// Load wallets on module initialization
loadWalletsFromFile();

// Load main wallet from private key (from env only)
function loadMainWallet(): Keypair {
  const privateKeyBytes = bs58.decode(config.mainWalletPrivateKey);
  return Keypair.fromSecretKey(privateKeyBytes);
}

const mainWallet = loadMainWallet();

export function getMainWalletAddress(): string {
  return mainWallet.publicKey.toBase58();
}

export function getMainWalletKeypair(): Keypair {
  return mainWallet;
}

/**
 * Get the RPC connection from the failover-enabled provider
 * Uses priority: Helius → QuickNode → Alchemy
 */
export function getConnection(): Connection {
  return getRPCConnection();
}

/**
 * Get RPC provider status (for monitoring)
 */
export { getRPCStatus };

export async function getWalletBalance(address: string): Promise<{ sol: number; usdc: number }> {
  const pubkey = new PublicKey(address);

  // Get SOL balance with automatic failover
  const solBalance = await executeWithFailover(
    (conn) => conn.getBalance(pubkey),
    'getBalance'
  );
  const sol = solBalance / LAMPORTS_PER_SOL;

  // Get USDC balance with automatic failover
  let usdc = 0;
  try {
    const usdcMint = new PublicKey(config.usdcMint);
    const ata = await getAssociatedTokenAddress(usdcMint, pubkey);
    const account = await executeWithFailover(
      (conn) => getAccount(conn, ata),
      'getTokenAccount'
    );
    usdc = Number(account.amount) / 1e6;
  } catch (e) {
    // No USDC account
  }

  return { sol, usdc };
}

export async function getMainWalletInfo(): Promise<WalletInfo> {
  const address = getMainWalletAddress();
  const { sol, usdc } = await getWalletBalance(address);

  return {
    address,
    solBalance: sol,
    usdcBalance: usdc,
  };
}

// Generate a single trading wallet
function generateWallet(label: string): TradingWallet {
  const keypair = Keypair.generate();
  const id = keypair.publicKey.toBase58().substring(0, 8);

  return {
    id,
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    createdAt: new Date().toISOString(),
    label,
  };
}

// Create a wallet pair (Primary Trading + Batch Trading POC)
export function createWalletPair(): WalletPair {
  const pairId = `pair-${Date.now().toString(36)}`;
  const timestamp = new Date().toISOString();

  const primaryWallet = generateWallet('Primary Trading');
  const batchWallet = generateWallet('Batch Trading POC');

  const pair: WalletPair = {
    id: pairId,
    primaryWallet,
    batchWallet,
    createdAt: timestamp,
  };

  // Store in maps
  walletPairs.set(pairId, pair);
  tradingWallets.set(primaryWallet.id, primaryWallet);
  tradingWallets.set(batchWallet.id, batchWallet);

  // Persist to file
  saveWalletsToFile();

  console.log(`Created wallet pair ${pairId}:`);
  console.log(`  Primary: ${primaryWallet.address}`);
  console.log(`  Batch:   ${batchWallet.address}`);

  return pair;
}

// Get all wallet pairs
export async function listWalletPairs(): Promise<WalletPair[]> {
  const pairs: WalletPair[] = [];

  for (const pair of walletPairs.values()) {
    // Get balances for both wallets
    const [primaryBal, batchBal] = await Promise.all([
      getWalletBalance(pair.primaryWallet.address),
      getWalletBalance(pair.batchWallet.address),
    ]);

    pairs.push({
      ...pair,
      primaryWallet: {
        ...pair.primaryWallet,
        privateKey: '***', // Don't expose
        solBalance: primaryBal.sol,
        usdcBalance: primaryBal.usdc,
      },
      batchWallet: {
        ...pair.batchWallet,
        privateKey: '***', // Don't expose
        solBalance: batchBal.sol,
        usdcBalance: batchBal.usdc,
      },
    });
  }

  return pairs;
}

// Legacy single wallet creation (for backward compatibility)
export function createTradingWallet(label?: string): TradingWallet {
  const wallet = generateWallet(label || 'Trading Wallet');
  tradingWallets.set(wallet.id, wallet);
  saveWalletsToFile();
  return wallet;
}

export function getTradingWallet(id: string): TradingWallet | undefined {
  return tradingWallets.get(id);
}

// Find trading wallet by address
export function getTradingWalletByAddress(address: string): TradingWallet | undefined {
  for (const wallet of tradingWallets.values()) {
    if (wallet.address === address) {
      return wallet;
    }
  }
  return undefined;
}

// Get keypair for a trading wallet by address
export function getTradingWalletKeypairByAddress(address: string): Keypair | undefined {
  const wallet = getTradingWalletByAddress(address);
  if (!wallet) return undefined;
  const privateKeyBytes = bs58.decode(wallet.privateKey);
  return Keypair.fromSecretKey(privateKeyBytes);
}

export function getTradingWalletKeypair(id: string): Keypair | undefined {
  const wallet = tradingWallets.get(id);
  if (!wallet) return undefined;

  const privateKeyBytes = bs58.decode(wallet.privateKey);
  return Keypair.fromSecretKey(privateKeyBytes);
}

export async function listTradingWallets(): Promise<TradingWallet[]> {
  const wallets: TradingWallet[] = [];

  for (const wallet of tradingWallets.values()) {
    const { sol, usdc } = await getWalletBalance(wallet.address);
    wallets.push({
      ...wallet,
      privateKey: '***', // Don't expose private key in list
      solBalance: sol,
      usdcBalance: usdc,
    });
  }

  return wallets;
}

export function deleteTradingWallet(id: string): boolean {
  const result = tradingWallets.delete(id);
  if (result) {
    saveWalletsToFile();
  }
  return result;
}

export function deleteWalletPair(pairId: string): boolean {
  const pair = walletPairs.get(pairId);
  if (!pair) return false;

  tradingWallets.delete(pair.primaryWallet.id);
  tradingWallets.delete(pair.batchWallet.id);
  walletPairs.delete(pairId);
  saveWalletsToFile();
  return true;
}

// Get keypair for any wallet (main or trading)
export function getWalletKeypair(walletId?: string): Keypair {
  if (!walletId) {
    return mainWallet;
  }

  const keypair = getTradingWalletKeypair(walletId);
  if (!keypair) {
    throw new Error(`Trading wallet not found: ${walletId}`);
  }

  return keypair;
}

// Get wallet keypair by address (searches all trading wallets and wallet pairs)
export function getWalletKeypairByAddress(address: string): Keypair | undefined {
  // Check if it's the main wallet
  if (mainWallet.publicKey.toBase58() === address) {
    return mainWallet;
  }

  // Search through all trading wallets
  for (const wallet of tradingWallets.values()) {
    if (wallet.address === address) {
      const privateKeyBytes = bs58.decode(wallet.privateKey);
      return Keypair.fromSecretKey(privateKeyBytes);
    }
  }

  // Search through all wallet pairs
  for (const pair of walletPairs.values()) {
    if (pair.primaryWallet.address === address) {
      return Keypair.fromSecretKey(bs58.decode(pair.primaryWallet.privateKey));
    }
    if (pair.batchWallet.address === address) {
      return Keypair.fromSecretKey(bs58.decode(pair.batchWallet.privateKey));
    }
  }

  return undefined;
}

// Get wallet pair by ID
export function getWalletPair(pairId: string): WalletPair | undefined {
  return walletPairs.get(pairId);
}

// Get both keypairs for a wallet pair
export function getWalletPairKeypairs(pairId: string): { primary: Keypair; batch: Keypair } | undefined {
  const pair = walletPairs.get(pairId);
  if (!pair) return undefined;

  const primary = Keypair.fromSecretKey(bs58.decode(pair.primaryWallet.privateKey));
  const batch = Keypair.fromSecretKey(bs58.decode(pair.batchWallet.privateKey));

  return { primary, batch };
}
