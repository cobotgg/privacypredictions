/**
 * Arcium MPC Client Service
 *
 * Handles encrypted computations using Arcium's MPC network.
 * Used for private trading operations where order data must remain confidential.
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';

// Arcium Program IDs (mainnet)
const ARCIUM_PROGRAM_ID = new PublicKey('ArcProgramXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
const PRIVACY_TRADING_PROGRAM_ID = new PublicKey('PrvTrade11111111111111111111111111111111111');

// MXE Public Key for encryption (from devnet cluster)
const MXE_PUBLIC_KEY_HEX = '55912ee0367bbbf20eb497b7b16801367c18c3b10710ff3771e5551f8bc95baa';

/**
 * Arcium cluster configuration
 */
export interface ArciumConfig {
  clusterOffset: number;
  mxePublicKey: Uint8Array;
  programId: PublicKey;
}

/**
 * Encrypted order data
 */
export interface EncryptedOrder {
  encryptedAmount: Uint8Array;
  encryptedWalletLo: Uint8Array;
  encryptedWalletHi: Uint8Array;
  userPubkey: Uint8Array;
  nonce: bigint;
  commitmentHash: Uint8Array;
}

/**
 * Batch state
 */
export interface BatchState {
  batchId: string;
  marketId: string;
  side: 'yes' | 'no';
  status: 'open' | 'closed' | 'executed' | 'verified';
  orderCount: number;
  totalUsdc: bigint;
  merkleRoot: Uint8Array;
}

// Connection instance
let connection: Connection | null = null;
let config: ArciumConfig | null = null;

/**
 * Initialize the Arcium client
 */
export function initArciumClient(rpcUrl: string, clusterOffset: number = 0): void {
  connection = new Connection(rpcUrl, 'confirmed');
  config = {
    clusterOffset,
    mxePublicKey: hexToBytes(MXE_PUBLIC_KEY_HEX),
    programId: PRIVACY_TRADING_PROGRAM_ID,
  };

  console.log('[Arcium] Client initialized with cluster offset:', clusterOffset);
}

/**
 * Get MXE public key for encryption
 */
export function getMxePublicKey(): Uint8Array {
  if (!config) {
    throw new Error('Arcium client not initialized');
  }
  return config.mxePublicKey;
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Generate a random nonce for encryption
 */
export function generateNonce(): bigint {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let nonce = BigInt(0);
  for (let i = 0; i < 16; i++) {
    nonce = (nonce << BigInt(8)) | BigInt(bytes[i]);
  }
  return nonce;
}

/**
 * Simple XOR cipher for encryption (matches frontend)
 * In production, use Rescue cipher from @arcium-hq/client
 */
function xorCipher(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

/**
 * Compute commitment hash for an order
 */
export function computeOrderCommitment(
  marketId: string,
  side: number,
  amount: bigint,
  walletLo: bigint,
  walletHi: bigint,
  salt: bigint
): Uint8Array {
  // Simple hash combining all inputs (placeholder for Poseidon)
  const combined = new Uint8Array(128);
  const encoder = new TextEncoder();

  // Market ID
  const marketBytes = encoder.encode(marketId);
  combined.set(marketBytes.slice(0, 32), 0);

  // Side
  combined[32] = side;

  // Amount (8 bytes)
  const amountBytes = new Uint8Array(8);
  let temp = amount;
  for (let i = 0; i < 8; i++) {
    amountBytes[i] = Number(temp & BigInt(0xff));
    temp = temp >> BigInt(8);
  }
  combined.set(amountBytes, 33);

  // Wallet (32 bytes)
  const walletBytes = new Uint8Array(32);
  let wLo = walletLo;
  for (let i = 0; i < 16; i++) {
    walletBytes[i] = Number(wLo & BigInt(0xff));
    wLo = wLo >> BigInt(8);
  }
  let wHi = walletHi;
  for (let i = 0; i < 16; i++) {
    walletBytes[16 + i] = Number(wHi & BigInt(0xff));
    wHi = wHi >> BigInt(8);
  }
  combined.set(walletBytes, 41);

  // Salt (16 bytes)
  const saltBytes = new Uint8Array(16);
  let s = salt;
  for (let i = 0; i < 16; i++) {
    saltBytes[i] = Number(s & BigInt(0xff));
    s = s >> BigInt(8);
  }
  combined.set(saltBytes, 73);

  // Simple hash (XOR reduction + rotation)
  const hash = new Uint8Array(32);
  for (let i = 0; i < combined.length; i++) {
    hash[i % 32] ^= combined[i];
    // Rotate
    const carry = hash[0];
    for (let j = 0; j < 31; j++) {
      hash[j] = (hash[j] << 1) | (hash[j + 1] >> 7);
    }
    hash[31] = (hash[31] << 1) | (carry >> 7);
  }

  return hash;
}

/**
 * Derive batch PDA address
 */
export function deriveBatchAddress(
  marketId: string,
  authority: PublicKey
): PublicKey {
  const [batchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('batch'), Buffer.from(marketId), authority.toBuffer()],
    PRIVACY_TRADING_PROGRAM_ID
  );
  return batchPda;
}

/**
 * Derive order PDA address
 */
export function deriveOrderAddress(
  batchAddress: PublicKey,
  orderIndex: number
): PublicKey {
  const [orderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), batchAddress.toBuffer(), Buffer.from([orderIndex])],
    PRIVACY_TRADING_PROGRAM_ID
  );
  return orderPda;
}

/**
 * Get cluster account addresses
 */
export function getClusterAccounts(): {
  mxeAccount: PublicKey;
  mempoolAccount: PublicKey;
  executingPool: PublicKey;
  clusterAccount: PublicKey;
  feePool: PublicKey;
  clockAccount: PublicKey;
} {
  if (!config) {
    throw new Error('Arcium client not initialized');
  }

  // These are derived from the Arcium program and cluster offset
  // In production, use @arcium-hq/client to derive these
  const baseSeed = Buffer.from('arcium');

  const [mxeAccount] = PublicKey.findProgramAddressSync(
    [baseSeed, Buffer.from('mxe'), PRIVACY_TRADING_PROGRAM_ID.toBuffer()],
    ARCIUM_PROGRAM_ID
  );

  const [mempoolAccount] = PublicKey.findProgramAddressSync(
    [baseSeed, Buffer.from('mempool'), Buffer.from([config.clusterOffset])],
    ARCIUM_PROGRAM_ID
  );

  const [executingPool] = PublicKey.findProgramAddressSync(
    [baseSeed, Buffer.from('execpool'), Buffer.from([config.clusterOffset])],
    ARCIUM_PROGRAM_ID
  );

  const [clusterAccount] = PublicKey.findProgramAddressSync(
    [baseSeed, Buffer.from('cluster'), Buffer.from([config.clusterOffset])],
    ARCIUM_PROGRAM_ID
  );

  const [feePool] = PublicKey.findProgramAddressSync(
    [baseSeed, Buffer.from('feepool')],
    ARCIUM_PROGRAM_ID
  );

  const [clockAccount] = PublicKey.findProgramAddressSync(
    [baseSeed, Buffer.from('clock')],
    ARCIUM_PROGRAM_ID
  );

  return {
    mxeAccount,
    mempoolAccount,
    executingPool,
    clusterAccount,
    feePool,
    clockAccount,
  };
}

/**
 * Check if Arcium is available
 */
export function isArciumAvailable(): boolean {
  return config !== null && connection !== null;
}

/**
 * Get Arcium status
 */
export function getArciumStatus(): {
  available: boolean;
  clusterOffset?: number;
  mxeKeyId?: string;
} {
  if (!config) {
    return { available: false };
  }

  return {
    available: true,
    clusterOffset: config.clusterOffset,
    mxeKeyId: MXE_PUBLIC_KEY_HEX.substring(0, 16) + '...',
  };
}
