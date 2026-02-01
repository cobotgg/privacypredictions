import { Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';
import { config } from '../config/env.js';
import { getConnection, createTradingWallet, getTradingWalletKeypair, getMainWalletKeypair, getTradingWallet, getWalletKeypair, listTradingWallets } from './wallet.js';
import type { PrivacyDeposit } from '../types/index.js';
import { screenTransaction, isRangeEnabled, shouldBlockTransaction, needsReview } from './range.js';

// Import ShadowWire SDK for ZK shielded transfers
import {
  ShadowWireClient,
  TokenUtils,
  initWASM,
  generateRangeProof,
  type TokenSymbol,
  type WalletAdapter,
  type ZKProofData,
} from '@radr/shadowwire';

// File-based persistence for operations (survives restarts)
const DATA_DIR = path.join(process.cwd(), '.privacy-data');
const OPERATIONS_FILE = path.join(DATA_DIR, 'operations.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize ShadowWire client for ZK shielded transfers
const shadowWireClient = new ShadowWireClient({
  apiBaseUrl: 'https://shadow.radr.fun/shadowpay/api',
  network: 'mainnet-beta',
  debug: process.env.NODE_ENV === 'development',
});

// Track WASM initialization
let wasmInitialized = false;
let wasmInitializationError: string | null = null;

// ShadowWire fee percentages (from SDK constants)
const SHADOWWIRE_FEES: Record<string, number> = {
  SOL: 0.01,  // 1%
  USDC: 0.005, // 0.5%
  DEFAULT: 0.01,
};

/**
 * Calculate the expected fee for a ShadowWire transfer
 */
function calculateShadowWireFee(amount: number, token: 'sol' | 'usdc'): number {
  const feeRate = token === 'usdc' ? SHADOWWIRE_FEES.USDC : SHADOWWIRE_FEES.SOL;
  return amount * feeRate;
}

/**
 * Initialize WASM for ZK proof generation (call once at startup)
 * Returns true if WASM is ready, false otherwise
 */
export async function initializePrivacyPool(): Promise<boolean> {
  if (wasmInitialized) {
    return true;
  }

  if (wasmInitializationError) {
    // Already tried and failed - don't retry every time
    console.warn(`[Privacy] WASM previously failed: ${wasmInitializationError}`);
    return false;
  }

  try {
    console.log('[Privacy] Initializing WASM for ZK proof generation...');
    await initWASM();
    wasmInitialized = true;
    wasmInitializationError = null;
    console.log('[Privacy] WASM initialized successfully');
    return true;
  } catch (error: any) {
    wasmInitializationError = error.message;
    console.error('[Privacy] CRITICAL: Failed to initialize WASM:', error.message);
    console.error('[Privacy] ZK shielded transfers will fail without WASM');
    return false;
  }
}

/**
 * Check if WASM is initialized and ready for ZK operations
 */
export function isWASMReady(): boolean {
  return wasmInitialized;
}

/**
 * Get WASM initialization error if any
 */
export function getWASMError(): string | null {
  return wasmInitializationError;
}

// Cache ed25519 configuration
let ed25519Configured = false;

/**
 * Configure ed25519 with sha512 for Node.js (required once)
 */
async function ensureEd25519Configured(): Promise<void> {
  if (!ed25519Configured) {
    const ed = await import('@noble/ed25519');
    const { sha512 } = await import('@noble/hashes/sha2.js');
    (ed.etc as any).sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));
    ed25519Configured = true;
  }
}

/**
 * Create a WalletAdapter from a Keypair for signing operations
 */
function createWalletAdapter(keypair: Keypair): WalletAdapter {
  return {
    signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
      // Ensure ed25519 is configured with sha512
      await ensureEd25519Configured();
      const ed = await import('@noble/ed25519');
      const signature = await ed.signAsync(message, keypair.secretKey.slice(0, 32));
      return signature;
    },
  };
}

/**
 * Map our token types to ShadowWire token symbols
 */
function mapTokenToSymbol(token: 'sol' | 'usdc'): TokenSymbol {
  return token === 'sol' ? 'SOL' : 'USDC';
}

// In-memory storage for privacy operations
const privacyDeposits: Map<string, PrivacyDeposit> = new Map();
const privacyWithdrawals: Map<string, PrivacyWithdrawal> = new Map();

// Store operations for recovery
export interface PendingOperation {
  operationId: string;
  amount: number;
  token: 'sol' | 'usdc';
  targetWalletId?: string;
  targetWalletAddress: string;
  sourceWalletAddress: string;
  createdAt: string;
  status: 'pending' | 'depositing' | 'transferring' | 'completed' | 'failed';
  error?: string;
  depositSignature?: string;
  transferSignature?: string;
  withdrawSignature?: string;  // Alias for transferSignature (backward compatibility)
  poolAddress?: string;
  zkProof?: boolean;
}
const pendingOperations: Map<string, PendingOperation> = new Map();

export interface PrivacyWithdrawal {
  id: string;
  amount: number;
  token: 'sol' | 'usdc';
  status: 'pending' | 'confirmed' | 'failed';
  sourceWalletId: string;
  destinationType: 'main' | 'external';
  destinationAddress: string;
  depositSignature?: string;
  transferSignature?: string;
  createdAt: string;
  error?: string;
  zkProof?: boolean;
}

// Load operations from disk on startup
function loadOperations(): void {
  try {
    if (fs.existsSync(OPERATIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(OPERATIONS_FILE, 'utf-8'));
      for (const op of data) {
        pendingOperations.set(op.operationId, op);
      }
      console.log(`[Privacy] Loaded ${pendingOperations.size} pending operations from disk`);
    }
  } catch (error: any) {
    console.error('[Privacy] Failed to load operations:', error.message);
  }
}

// Save operations to disk (atomic write to prevent corruption)
function saveOperations(): void {
  try {
    const data = Array.from(pendingOperations.values());
    const tempFile = `${OPERATIONS_FILE}.tmp`;
    const backupFile = `${OPERATIONS_FILE}.bak`;

    // Write to temp file first
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));

    // Backup existing file if it exists
    if (fs.existsSync(OPERATIONS_FILE)) {
      try {
        fs.copyFileSync(OPERATIONS_FILE, backupFile);
      } catch {
        // Ignore backup failures
      }
    }

    // Atomic rename temp to actual file
    fs.renameSync(tempFile, OPERATIONS_FILE);
  } catch (error: any) {
    console.error('[Privacy] Failed to save operations:', error.message);
  }
}

// Load on module init
loadOperations();

// Export for status checking
export function getPendingOperations(): PendingOperation[] {
  return Array.from(pendingOperations.values()).filter(op => op.status !== 'completed');
}

export function getOperationStatus(operationId: string): PendingOperation | undefined {
  return pendingOperations.get(operationId);
}

// Valid state transitions for operations
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['depositing', 'failed'],
  depositing: ['transferring', 'failed'],
  transferring: ['completed', 'failed'],
  failed: ['completed'], // Recovery can mark failed as completed
  completed: [], // Terminal state
};

function updateOperation(operationId: string, updates: Partial<PendingOperation>): void {
  const op = pendingOperations.get(operationId);
  if (op) {
    // Validate state transition if status is being updated
    if (updates.status && updates.status !== op.status) {
      const allowedTransitions = VALID_TRANSITIONS[op.status] || [];
      if (!allowedTransitions.includes(updates.status)) {
        console.warn(`[Privacy] Invalid state transition: ${op.status} -> ${updates.status} for operation ${operationId}`);
        // Allow the transition but log it
      }
    }

    // Add timestamp for status changes
    const updatedOp = {
      ...op,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    pendingOperations.set(operationId, updatedOp);
    saveOperations();

    // Log important state changes
    if (updates.status) {
      console.log(`[Privacy] Operation ${operationId.slice(0, 8)}: ${op.status} -> ${updates.status}`);
    }
  }
}

/**
 * Clean up old completed and failed operations to prevent unbounded growth
 * Keeps operations from the last 24 hours
 */
export function cleanupOldOperations(): { removed: number; kept: number } {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const [opId, op] of pendingOperations.entries()) {
    const createdTime = new Date(op.createdAt).getTime();

    // Remove completed operations older than 24 hours
    if (op.status === 'completed' && createdTime < oneDayAgo) {
      pendingOperations.delete(opId);
      removed++;
    }

    // Remove failed operations older than 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (op.status === 'failed' && createdTime < sevenDaysAgo) {
      pendingOperations.delete(opId);
      removed++;
    }
  }

  if (removed > 0) {
    saveOperations();
    console.log(`[Privacy] Cleaned up ${removed} old operations`);
  }

  return { removed, kept: pendingOperations.size };
}

// Helper to check balance
async function checkSufficientBalance(
  sourceKeypair: Keypair,
  amount: number,
  token: 'sol' | 'usdc'
): Promise<{ sufficient: boolean; balance: number; error?: string }> {
  const connection = getConnection();

  try {
    if (token === 'sol') {
      const balance = await connection.getBalance(sourceKeypair.publicKey) / LAMPORTS_PER_SOL;
      const required = amount + 0.01; // Account for fees
      return {
        sufficient: balance >= required,
        balance,
        error: balance < required ? `Insufficient SOL: have ${balance.toFixed(4)}, need ${required.toFixed(4)}` : undefined,
      };
    } else {
      const usdcMint = new PublicKey(config.usdcMint);
      const ata = await getAssociatedTokenAddress(usdcMint, sourceKeypair.publicKey);
      const accountInfo = await connection.getTokenAccountBalance(ata);
      const balance = accountInfo.value.uiAmount || 0;
      return {
        sufficient: balance >= amount,
        balance,
        error: balance < amount ? `Insufficient USDC: have ${balance.toFixed(2)}, need ${amount.toFixed(2)}` : undefined,
      };
    }
  } catch (error: any) {
    const isNoAccount = error.message?.includes('could not find account');
    if (isNoAccount && token === 'usdc') {
      return { sufficient: false, balance: 0, error: 'No USDC account found' };
    }
    return { sufficient: false, balance: 0, error: `Failed to check balance: ${error.message}` };
  }
}

export interface PrivacyTransferResult {
  success: boolean;
  operationId?: string;
  tradingWalletId?: string;
  tradingWalletAddress?: string;
  depositSignature?: string;
  transferSignature?: string;
  withdrawSignature?: string;  // Alias for transferSignature (backward compatibility)
  poolAddress?: string;
  intermediateWallet?: string; // Pool address (backward compatibility)
  error?: string;
  zkProof?: boolean;
  message?: string;
  pending?: boolean;
}

export interface PrivacyWithdrawResult {
  success: boolean;
  operationId?: string;
  amountWithdrawn: number;
  token: 'sol' | 'usdc';
  depositSignature?: string;
  transferSignature?: string;
  withdrawSignature?: string;  // Alias for transferSignature (backward compatibility)
  intermediateWallet?: string; // Pool address (backward compatibility)
  destinationAddress?: string;
  errors: string[];
  zkProof?: boolean;
  compliance?: {
    screened: boolean;
    overallRisk: string;
    recommendation: string;
    reason?: string;
  };
}

/**
 * Check for duplicate pending operations (deduplication)
 * Returns existing operation ID if a similar operation is already in progress
 */
function checkForDuplicateOperation(
  sourceAddress: string,
  targetAddress: string,
  token: 'sol' | 'usdc'
): string | null {
  const thirtySecondsAgo = Date.now() - 30 * 1000;

  for (const [opId, op] of pendingOperations.entries()) {
    // Check if there's a recent pending/depositing/transferring operation for same params
    if (
      op.sourceWalletAddress === sourceAddress &&
      op.targetWalletAddress === targetAddress &&
      op.token === token &&
      ['pending', 'depositing', 'transferring'].includes(op.status) &&
      new Date(op.createdAt).getTime() > thirtySecondsAgo
    ) {
      return opId;
    }
  }
  return null;
}

/**
 * Privacy Pool Deposit: Fund a trading wallet via ZK shielded pool
 *
 * Flow:
 * 1. Main Wallet deposits to ShadowWire shielded pool
 * 2. External ZK transfer from pool to Trading Wallet
 *
 * Result: No on-chain link between main wallet and trading wallet
 */
export async function privacyTransfer(
  sourceKeypair: Keypair,
  amount: number,
  token: 'sol' | 'usdc',
  targetWalletId?: string
): Promise<PrivacyTransferResult> {
  const operationId = uuidv4();
  const connection = getConnection();
  const tokenSymbol = mapTokenToSymbol(token);

  try {
    // Initialize WASM first and fail fast if not available
    const wasmReady = await initializePrivacyPool();
    if (!wasmReady) {
      const wasmError = getWASMError();
      return {
        success: false,
        error: `ZK proof generation unavailable: ${wasmError || 'WASM initialization failed'}. Please try again or contact support.`,
      };
    }

    // Determine target wallet early for deduplication check
    let tradingWallet;
    if (targetWalletId) {
      tradingWallet = getTradingWallet(targetWalletId);
      if (!tradingWallet) {
        return { success: false, error: 'Target wallet not found' };
      }
    }

    // Check for duplicate operations
    if (tradingWallet) {
      const duplicateOpId = checkForDuplicateOperation(
        sourceKeypair.publicKey.toBase58(),
        tradingWallet.address,
        token
      );
      if (duplicateOpId) {
        console.warn(`[Privacy] Duplicate operation detected: ${duplicateOpId}`);
        return {
          success: false,
          operationId: duplicateOpId,
          error: `A similar transfer is already in progress (operation: ${duplicateOpId.slice(0, 8)}). Please wait for it to complete.`,
        };
      }
    }

    // Pre-check balance
    const balanceCheck = await checkSufficientBalance(sourceKeypair, amount, token);
    if (!balanceCheck.sufficient) {
      return { success: false, error: balanceCheck.error };
    }
    console.log(`[Privacy] Balance check passed: ${balanceCheck.balance} ${token.toUpperCase()}`);

    // Check SOL for fees if transferring USDC
    if (token === 'usdc') {
      const solBalance = await connection.getBalance(sourceKeypair.publicKey) / LAMPORTS_PER_SOL;
      if (solBalance < 0.02) {
        return { success: false, error: `Insufficient SOL for fees: have ${solBalance.toFixed(4)}, need 0.02` };
      }
    }

    // Create new wallet if no target specified (tradingWallet was checked earlier for deduplication)
    if (!tradingWallet) {
      tradingWallet = createTradingWallet(`Privacy-${Date.now()}`);
    }

    // Create pending operation
    const pendingOp: PendingOperation = {
      operationId,
      amount,
      token,
      targetWalletAddress: tradingWallet.address,
      sourceWalletAddress: sourceKeypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      status: 'depositing',
      zkProof: true,
    };
    pendingOperations.set(operationId, pendingOp);
    saveOperations();

    console.log(`[Privacy] Starting ZK shielded transfer: ${amount} ${token.toUpperCase()}`);
    console.log(`[Privacy] Source: ${sourceKeypair.publicKey.toBase58()}`);
    console.log(`[Privacy] Target: ${tradingWallet.address}`);

    // Convert amount to smallest units
    const amountSmallestUnit = TokenUtils.toSmallestUnit(amount, tokenSymbol);
    const tokenMint = token === 'usdc' ? config.usdcMint : undefined;

    // Step 1: Deposit to ShadowWire shielded pool
    console.log(`[Privacy] Step 1: Depositing to shielded pool...`);
    const depositResponse = await shadowWireClient.deposit({
      wallet: sourceKeypair.publicKey.toBase58(),
      amount: amountSmallestUnit,
      token_mint: tokenMint,
    });

    if (!depositResponse.success) {
      updateOperation(operationId, { status: 'failed', error: 'Failed to create deposit transaction' });
      return { success: false, error: 'Failed to create deposit transaction' };
    }

    // Sign and send the deposit transaction
    const depositTxBuffer = Buffer.from(depositResponse.unsigned_tx_base64, 'base64');
    let depositSignature: string;

    try {
      // Try as versioned transaction first
      const versionedTx = VersionedTransaction.deserialize(depositTxBuffer);
      versionedTx.sign([sourceKeypair]);
      depositSignature = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch {
      // Fallback to legacy transaction
      const legacyTx = Transaction.from(depositTxBuffer);
      legacyTx.sign(sourceKeypair);
      depositSignature = await connection.sendTransaction(legacyTx, [sourceKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    }

    console.log(`[Privacy] Deposit tx sent: ${depositSignature}`);

    // Wait for confirmation
    await connection.confirmTransaction(depositSignature, 'confirmed');
    console.log(`[Privacy] Deposit confirmed. Pool address: ${depositResponse.pool_address}`);

    updateOperation(operationId, {
      status: 'transferring',
      depositSignature,
      poolAddress: depositResponse.pool_address,
    });

    // Wait for pool balance to be updated (RPC propagation delay)
    console.log(`[Privacy] Waiting for pool balance to update...`);
    const maxRetries = 15; // Increased from 10
    const baseDelay = 2000; // Start with 2 seconds
    let poolReady = false;
    const expectedFee = calculateShadowWireFee(amount, token);
    const minExpectedBalance = (amount - expectedFee) * 0.98; // Allow 2% tolerance for rounding
    const minExpectedSmallestUnit = TokenUtils.toSmallestUnit(minExpectedBalance, tokenSymbol);

    console.log(`[Privacy] Expecting pool balance >= ${minExpectedBalance.toFixed(6)} ${token.toUpperCase()} (after ${(expectedFee * 100 / amount).toFixed(2)}% fee)`);

    for (let i = 0; i < maxRetries; i++) {
      try {
        const poolBalance = await shadowWireClient.getBalance(
          sourceKeypair.publicKey.toBase58(),
          tokenSymbol
        );
        if (poolBalance.available >= minExpectedSmallestUnit) {
          const availableUI = TokenUtils.fromSmallestUnit(poolBalance.available, tokenSymbol);
          console.log(`[Privacy] Pool balance confirmed: ${availableUI.toFixed(6)} ${token.toUpperCase()} available`);
          poolReady = true;
          break;
        }
        const availableUI = TokenUtils.fromSmallestUnit(poolBalance.available, tokenSymbol);
        // Use exponential backoff after first few retries
        const delay = i < 3 ? baseDelay : baseDelay * Math.min(i - 2, 4);
        console.log(`[Privacy] Pool balance: ${availableUI.toFixed(6)} (need ${minExpectedBalance.toFixed(6)}), retry ${i + 1}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (e: any) {
        console.log(`[Privacy] Pool check error: ${e.message}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, baseDelay));
      }
    }

    if (!poolReady) {
      console.error(`[Privacy] Pool balance not updated after ${maxRetries} retries. Attempting recovery...`);

      // Attempt automatic recovery - withdraw from pool back to source
      const recovered = await attemptPoolRecovery(sourceKeypair, token, connection);
      const error = recovered
        ? 'Pool balance not updated - funds automatically recovered to source wallet. Please retry.'
        : 'Pool balance not updated - CRITICAL: Manual recovery may be needed via /api/transfer/recover endpoint.';

      updateOperation(operationId, { status: 'failed', error });
      return { success: false, error, pending: !recovered };
    }

    // Step 2: Execute external transfer to trading wallet using SDK's transfer() method
    // This handles ZK proof generation and signature authentication properly
    console.log(`[Privacy] Step 2: Executing ZK shielded transfer to trading wallet...`);

    // Create wallet adapter for signing
    const walletAdapter = createWalletAdapter(sourceKeypair);

    let transferResponse;
    try {
      // Use SDK's transfer() method which handles:
      // 1. ZK proof generation (initWASM + generateRangeProof)
      // 2. Proper signature authentication
      // 3. Correct API request format
      transferResponse = await shadowWireClient.transfer({
        sender: sourceKeypair.publicKey.toBase58(),
        recipient: tradingWallet.address,
        amount: amount, // Use original amount (SDK converts to smallest unit)
        token: tokenSymbol,
        type: 'external',
        wallet: walletAdapter,
      });
    } catch (transferError: any) {
      const errorMsg = transferError.message || 'ZK transfer failed';
      console.error('[Privacy] Transfer error:', errorMsg);
      updateOperation(operationId, { status: 'failed', error: errorMsg });
      return { success: false, error: errorMsg };
    }

    if (!transferResponse.success) {
      updateOperation(operationId, { status: 'failed', error: 'ZK transfer failed' });
      return { success: false, error: 'ZK transfer failed' };
    }

    console.log(`[Privacy] ZK transfer completed: ${transferResponse.tx_signature}`);
    console.log(`[Privacy] Amount hidden: ${transferResponse.amount_hidden}`);

    // Update operation as completed
    updateOperation(operationId, {
      status: 'completed',
      transferSignature: transferResponse.tx_signature,
    });

    // Store deposit info
    const deposit: PrivacyDeposit = {
      id: operationId,
      amount,
      token,
      status: 'confirmed',
      depositSignature,
      createdAt: new Date().toISOString(),
    };
    privacyDeposits.set(operationId, deposit);

    return {
      success: true,
      operationId,
      tradingWalletId: tradingWallet.id,
      tradingWalletAddress: tradingWallet.address,
      depositSignature,
      transferSignature: transferResponse.tx_signature,
      withdrawSignature: transferResponse.tx_signature, // Backward compatibility
      poolAddress: depositResponse.pool_address,
      intermediateWallet: depositResponse.pool_address, // Backward compatibility
      zkProof: true,
      message: 'ZK shielded transfer completed! Funds are now in your trading wallet with no on-chain link to your main wallet.',
    };
  } catch (error: any) {
    console.error('[Privacy] Transfer error:', error.message);
    updateOperation(operationId, { status: 'failed', error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Privacy Pool Withdrawal: Withdraw from trading wallet to main wallet via ZK shielded pool
 *
 * Flow:
 * 1. Range Compliance screening (if enabled)
 * 2. Trading Wallet deposits to ShadowWire shielded pool
 * 3. External ZK transfer from pool to Main Wallet
 *
 * Result: No on-chain link between trading wallet and main wallet
 */
export async function privacyWithdraw(
  tradingWalletId: string,
  token: 'sol' | 'usdc' | 'all',
  destinationType: 'main' | 'external' = 'main',
  externalAddress?: string,
  skipCompliance: boolean = false
): Promise<PrivacyWithdrawResult> {
  const operationId = uuidv4();
  const connection = getConnection();
  const result: PrivacyWithdrawResult = {
    success: false,
    operationId,
    amountWithdrawn: 0,
    token: token === 'all' ? 'usdc' : token,
    errors: [],
    zkProof: true,
  };

  try {
    // Initialize WASM and fail fast if not available
    const wasmReady = await initializePrivacyPool();
    if (!wasmReady) {
      const wasmError = getWASMError();
      result.errors.push(`ZK proof generation unavailable: ${wasmError || 'WASM initialization failed'}`);
      return result;
    }

    // Get trading wallet keypair
    const tradingKeypair = getTradingWalletKeypair(tradingWalletId);
    if (!tradingKeypair) {
      result.errors.push('Trading wallet not found');
      return result;
    }

    // Determine destination
    let destinationAddress: string;
    if (destinationType === 'main') {
      destinationAddress = getMainWalletKeypair().publicKey.toBase58();
    } else if (externalAddress) {
      destinationAddress = externalAddress;
    } else {
      result.errors.push('External address required for external withdrawals');
      return result;
    }

    result.destinationAddress = destinationAddress;

    // Range Compliance Screening
    if (!skipCompliance && isRangeEnabled()) {
      console.log(`[Privacy Withdraw] Running Range compliance screening...`);

      try {
        const fromAddress = tradingKeypair.publicKey.toBase58();
        const screeningResult = await screenTransaction(
          fromAddress,
          destinationAddress,
          0, // Amount not needed for address screening
          token === 'all' ? 'SOL' : token.toUpperCase(),
          'solana'
        );

        result.compliance = {
          screened: true,
          overallRisk: screeningResult.overallRisk,
          recommendation: screeningResult.recommendation,
          reason: screeningResult.reason,
        };

        console.log(`[Privacy Withdraw] Compliance result: ${screeningResult.recommendation} (${screeningResult.overallRisk} risk)`);

        // Block sanctioned or severe risk addresses
        if (shouldBlockTransaction(screeningResult)) {
          result.errors.push(`Withdrawal blocked by compliance: ${screeningResult.reason || 'Sanctioned or severe risk address detected'}`);
          console.log(`[Privacy Withdraw] BLOCKED: ${screeningResult.reason}`);
          return result;
        }

        // Warn about high/medium risk but allow (for manual review)
        if (needsReview(screeningResult)) {
          console.log(`[Privacy Withdraw] WARNING: Transaction flagged for review - ${screeningResult.reason}`);
          // Continue but log warning
        }
      } catch (complianceError: any) {
        console.error('[Privacy Withdraw] Compliance check error:', complianceError.message);
        // Fail open - continue with withdrawal if compliance service is down
        result.compliance = {
          screened: false,
          overallRisk: 'unknown',
          recommendation: 'review',
          reason: 'Compliance service unavailable - proceeded with caution',
        };
      }
    } else if (!skipCompliance) {
      result.compliance = {
        screened: false,
        overallRisk: 'unknown',
        recommendation: 'allow',
        reason: 'Range compliance not configured',
      };
    }

    // Get current balances
    const solBalance = await connection.getBalance(tradingKeypair.publicKey) / LAMPORTS_PER_SOL;
    let usdcBalance = 0;
    try {
      const usdcMint = new PublicKey(config.usdcMint);
      const ata = await getAssociatedTokenAddress(usdcMint, tradingKeypair.publicKey);
      const accountInfo = await connection.getTokenAccountBalance(ata);
      usdcBalance = accountInfo.value.uiAmount || 0;
    } catch {
      // No USDC account
    }

    console.log(`[Privacy Withdraw] Balances: SOL=${solBalance}, USDC=${usdcBalance}`);

    // Check for minimum SOL balance required for fees (needed for both SOL and USDC withdrawals)
    const MIN_SOL_FOR_FEES = 0.005;
    if (solBalance < MIN_SOL_FOR_FEES) {
      const errorMsg = `Insufficient SOL for transaction fees: have ${solBalance.toFixed(6)} SOL, need at least ${MIN_SOL_FOR_FEES} SOL`;
      console.error(`[Privacy Withdraw] ${errorMsg}`);
      result.errors.push(errorMsg);
      result.success = false;
      return result;
    }

    // Process USDC withdrawal
    if ((token === 'usdc' || token === 'all') && usdcBalance > 0) {
      try {
        const withdrawResult = await executeShieldedWithdrawal(
          tradingKeypair,
          destinationAddress,
          usdcBalance,
          'usdc',
          connection
        );

        if (withdrawResult.success) {
          result.amountWithdrawn += usdcBalance;
          result.depositSignature = withdrawResult.depositSignature;
          result.transferSignature = withdrawResult.transferSignature;
          result.withdrawSignature = withdrawResult.transferSignature; // Backward compatibility
          result.intermediateWallet = 'shielded-pool'; // Backward compatibility
          result.token = 'usdc';
        } else {
          result.errors.push(`USDC withdrawal failed: ${withdrawResult.error}`);
        }
      } catch (e: any) {
        result.errors.push(`USDC withdraw error: ${e.message}`);
      }
    }

    // Process SOL withdrawal
    if ((token === 'sol' || token === 'all') && solBalance > 0.01) {
      try {
        const solToWithdraw = solBalance - 0.005; // Keep minimum for fees
        const withdrawResult = await executeShieldedWithdrawal(
          tradingKeypair,
          destinationAddress,
          solToWithdraw,
          'sol',
          connection
        );

        if (withdrawResult.success) {
          result.amountWithdrawn += solToWithdraw;
          if (!result.depositSignature) result.depositSignature = withdrawResult.depositSignature;
          result.transferSignature = withdrawResult.transferSignature;
          result.withdrawSignature = withdrawResult.transferSignature; // Backward compatibility
          result.intermediateWallet = 'shielded-pool'; // Backward compatibility
          result.token = 'sol';
        } else {
          result.errors.push(`SOL withdrawal failed: ${withdrawResult.error}`);
        }
      } catch (e: any) {
        result.errors.push(`SOL withdraw error: ${e.message}`);
      }
    }

    // Store withdrawal record
    const withdrawal: PrivacyWithdrawal = {
      id: operationId,
      amount: result.amountWithdrawn,
      token: result.token,
      status: result.errors.length === 0 ? 'confirmed' : 'failed',
      sourceWalletId: tradingWalletId,
      destinationType,
      destinationAddress,
      depositSignature: result.depositSignature,
      transferSignature: result.transferSignature,
      createdAt: new Date().toISOString(),
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      zkProof: true,
    };
    privacyWithdrawals.set(operationId, withdrawal);

    result.success = result.errors.length === 0;
    return result;
  } catch (error: any) {
    console.error('[Privacy] Withdraw error:', error.message);
    result.errors.push(error.message);
    return result;
  }
}

/**
 * Execute a shielded withdrawal through ShadowWire pool
 *
 * IMPORTANT: This function now includes automatic recovery if the external transfer fails.
 * If funds get deposited to the pool but can't be transferred out, they will be
 * automatically withdrawn back to the source wallet.
 */
async function executeShieldedWithdrawal(
  sourceKeypair: Keypair,
  destinationAddress: string,
  amount: number,
  token: 'sol' | 'usdc',
  connection: any
): Promise<{ success: boolean; depositSignature?: string; transferSignature?: string; error?: string; recovered?: boolean }> {
  const tokenSymbol = mapTokenToSymbol(token);
  const amountSmallestUnit = TokenUtils.toSmallestUnit(amount, tokenSymbol);
  const tokenMint = token === 'usdc' ? config.usdcMint : undefined;
  const sourceAddress = sourceKeypair.publicKey.toBase58();

  console.log(`[Privacy Withdraw] Starting shielded withdrawal: ${amount} ${token.toUpperCase()}`);
  console.log(`[Privacy Withdraw] Source: ${sourceAddress}`);
  console.log(`[Privacy Withdraw] Destination: ${destinationAddress}`);

  // Step 1: Deposit to shielded pool
  console.log(`[Privacy Withdraw] Step 1: Depositing to shielded pool...`);
  const depositResponse = await shadowWireClient.deposit({
    wallet: sourceAddress,
    amount: amountSmallestUnit,
    token_mint: tokenMint,
  });

  if (!depositResponse.success) {
    const errorMsg = (depositResponse as any).error || 'API error';
    console.error(`[Privacy Withdraw] Deposit API failed: ${errorMsg}`);
    return { success: false, error: `Deposit failed: ${errorMsg}` };
  }

  if (!depositResponse.unsigned_tx_base64) {
    console.error(`[Privacy Withdraw] No unsigned transaction returned from deposit API`);
    return { success: false, error: 'Deposit failed: No transaction returned' };
  }

  // Sign and send deposit
  const depositTxBuffer = Buffer.from(depositResponse.unsigned_tx_base64, 'base64');
  let depositSignature: string;

  try {
    try {
      const versionedTx = VersionedTransaction.deserialize(depositTxBuffer);
      versionedTx.sign([sourceKeypair]);
      depositSignature = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch {
      const legacyTx = Transaction.from(depositTxBuffer);
      legacyTx.sign(sourceKeypair);
      depositSignature = await connection.sendTransaction(legacyTx, [sourceKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    }

    await connection.confirmTransaction(depositSignature, 'confirmed');
    console.log(`[Privacy Withdraw] Step 1 complete - Deposit confirmed: ${depositSignature}`);
  } catch (depositError: any) {
    console.error(`[Privacy Withdraw] Deposit transaction failed: ${depositError.message}`);
    return { success: false, error: `Deposit transaction failed: ${depositError.message}` };
  }

  // Wait for pool balance to update with progressive delays
  console.log(`[Privacy Withdraw] Waiting for pool balance to update...`);
  const poolWaitDelays = [2000, 2000, 3000, 4000, 5000]; // Progressive delays
  const expectedFeeWithdraw = calculateShadowWireFee(amount, token);
  const minExpectedPoolBalance = amount - expectedFeeWithdraw - (amount * 0.02);

  for (let i = 0; i < poolWaitDelays.length; i++) {
    await new Promise(resolve => setTimeout(resolve, poolWaitDelays[i]));
    const checkBalance = await getShieldedPoolBalance(sourceAddress, token);
    if (checkBalance && checkBalance.available >= minExpectedPoolBalance) {
      console.log(`[Privacy Withdraw] Pool balance ready: ${checkBalance.available.toFixed(6)} ${token.toUpperCase()}`);
      break;
    }
    console.log(`[Privacy Withdraw] Pool balance check ${i + 1}/${poolWaitDelays.length}: ${checkBalance?.available || 0} (need ${minExpectedPoolBalance.toFixed(6)})`);
  }

  // Verify pool balance before attempting external transfer
  const poolBalance = await getShieldedPoolBalance(sourceAddress, token);
  console.log(`[Privacy Withdraw] Pool balance after deposit: ${poolBalance?.available || 0} ${token.toUpperCase()}`);

  // Account for ShadowWire fees when checking balance
  // The pool balance should be at least (amount - fee) after deposit
  const expectedFee = calculateShadowWireFee(amount, token);
  const minExpectedBalance = amount - expectedFee - (amount * 0.01); // Extra 1% tolerance for rounding

  console.log(`[Privacy Withdraw] Expected balance: ${minExpectedBalance.toFixed(6)} (after ${(expectedFee * 100).toFixed(2)}% fee)`);

  if (!poolBalance || poolBalance.available < minExpectedBalance) {
    console.error(`[Privacy Withdraw] Pool balance insufficient after deposit.`);
    console.error(`[Privacy Withdraw] Expected at least: ${minExpectedBalance.toFixed(6)}, Got: ${poolBalance?.available || 0}`);
    // Try to recover by withdrawing back to source
    const recovered = await attemptPoolRecovery(sourceKeypair, token, connection);
    return {
      success: false,
      depositSignature,
      error: `Pool balance not updated after deposit. Expected: ${minExpectedBalance.toFixed(6)}, Got: ${poolBalance?.available || 0}. ${recovered ? 'Funds recovered to source wallet.' : 'Manual recovery may be needed.'}`,
      recovered,
    };
  }

  // Step 2: Execute external transfer using SDK's higher-level transfer() method
  // This handles ZK proof generation and signature authentication properly
  console.log(`[Privacy Withdraw] Step 2: Executing ZK transfer to ${destinationAddress}...`);
  const walletAdapter = createWalletAdapter(sourceKeypair);
  // Note: tokenSymbol is already declared above

  const MAX_RETRIES = 3;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[Privacy Withdraw] External transfer attempt ${attempt}/${MAX_RETRIES}...`);

    try {
      // Use SDK's transfer() method which handles:
      // 1. ZK proof generation (initWASM + generateRangeProof)
      // 2. Proper signature authentication
      // 3. Correct API request format
      console.log(`[Privacy Withdraw] Calling SDK transfer: ${amount} ${tokenSymbol} from ${sourceAddress.slice(0, 8)}... to ${destinationAddress.slice(0, 8)}...`);

      const transferResponse = await shadowWireClient.transfer({
        sender: sourceAddress,
        recipient: destinationAddress,
        amount: amount, // Use original amount (SDK converts to smallest unit)
        token: tokenSymbol,
        type: 'external',
        wallet: walletAdapter,
      });

      console.log(`[Privacy Withdraw] SDK response: success=${transferResponse.success}, tx=${transferResponse.tx_signature || 'none'}`);

      if (transferResponse.success && transferResponse.tx_signature) {
        console.log(`[Privacy Withdraw] Step 2 complete - ZK transfer successful: ${transferResponse.tx_signature}`);
        console.log(`[Privacy Withdraw] Amount hidden: ${transferResponse.amount_hidden}`);
        return {
          success: true,
          depositSignature,
          transferSignature: transferResponse.tx_signature,
        };
      }

      // Log the full response for debugging
      lastError = `External transfer returned success=false: ${JSON.stringify(transferResponse)}`;
      console.warn(`[Privacy Withdraw] Attempt ${attempt} failed: ${lastError}`);

      if (attempt < MAX_RETRIES) {
        const delay = 2000 * attempt;
        console.log(`[Privacy Withdraw] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (transferError: any) {
      lastError = transferError.message || String(transferError);
      console.error(`[Privacy Withdraw] Attempt ${attempt} exception: ${lastError}`);

      // Check if it's a balance-related error that won't resolve with retries
      if (lastError.includes('Insufficient') || lastError.includes('insufficient')) {
        console.error(`[Privacy Withdraw] Balance error detected, skipping remaining retries`);
        break;
      }

      if (attempt < MAX_RETRIES) {
        const delay = 2000 * attempt;
        console.log(`[Privacy Withdraw] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed - attempt recovery
  console.error(`[Privacy Withdraw] All attempts failed. Attempting automatic recovery...`);
  const recovered = await attemptPoolRecovery(sourceKeypair, token, connection);

  return {
    success: false,
    depositSignature,
    error: `External transfer failed after ${MAX_RETRIES} attempts: ${lastError}. ${recovered ? 'Funds automatically recovered to source wallet.' : 'CRITICAL: Funds stuck in pool - use /api/transfer/recover/pool endpoint.'}`,
    recovered,
  };
}

/**
 * Attempt to recover funds from pool back to source wallet
 * Includes retry logic for robustness
 */
async function attemptPoolRecovery(
  sourceKeypair: Keypair,
  token: 'sol' | 'usdc',
  connection: any,
  maxRetries: number = 3
): Promise<boolean> {
  const sourceAddress = sourceKeypair.publicKey.toBase58();
  const tokenMint = token === 'usdc' ? config.usdcMint : undefined;

  console.log(`[Pool Recovery] Attempting automatic recovery for ${sourceAddress}...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Pool Recovery] Attempt ${attempt}/${maxRetries}...`);

      // Check current pool balance
      const poolBalance = await getShieldedPoolBalance(sourceAddress, token);
      if (!poolBalance || poolBalance.available <= 0) {
        console.log(`[Pool Recovery] No funds in pool to recover`);
        return false;
      }

      console.log(`[Pool Recovery] Found ${poolBalance.available} ${token.toUpperCase()} in pool`);

      // Withdraw from pool back to source wallet
      const withdrawResponse = await shadowWireClient.withdraw({
        wallet: sourceAddress,
        amount: TokenUtils.toSmallestUnit(poolBalance.available, mapTokenToSymbol(token)),
        token_mint: tokenMint,
      });

      if (!withdrawResponse.success || !withdrawResponse.unsigned_tx_base64) {
        const errorMsg = withdrawResponse.error || 'No transaction returned';
        console.error(`[Pool Recovery] Withdraw API failed: ${errorMsg}`);

        if (attempt < maxRetries) {
          const delay = 2000 * attempt;
          console.log(`[Pool Recovery] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return false;
      }

      // Sign and send withdraw transaction
      const txBuffer = Buffer.from(withdrawResponse.unsigned_tx_base64, 'base64');
      let signature: string;

      try {
        const versionedTx = VersionedTransaction.deserialize(txBuffer);
        versionedTx.sign([sourceKeypair]);
        signature = await connection.sendTransaction(versionedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
      } catch {
        const legacyTx = Transaction.from(txBuffer);
        legacyTx.sign(sourceKeypair);
        signature = await connection.sendTransaction(legacyTx, [sourceKeypair], {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
      }

      await connection.confirmTransaction(signature, 'confirmed');
      console.log(`[Pool Recovery] SUCCESS - Funds recovered: ${signature}`);
      return true;
    } catch (error: any) {
      console.error(`[Pool Recovery] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const delay = 2000 * attempt;
        console.log(`[Pool Recovery] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[Pool Recovery] All ${maxRetries} recovery attempts failed`);
  return false;
}

/**
 * Fund an existing trading wallet via ZK shielded pool
 */
export async function privacyFundWallet(
  targetWalletId: string,
  amount: number,
  token: 'sol' | 'usdc'
): Promise<PrivacyTransferResult> {
  const mainKeypair = getMainWalletKeypair();
  return privacyTransfer(mainKeypair, amount, token, targetWalletId);
}

/**
 * Start a privacy transfer in the background
 */
export async function startBackgroundTransfer(
  amount: number,
  token: 'sol' | 'usdc',
  targetWalletId?: string
): Promise<{ success: boolean; operationId?: string; error?: string }> {
  const operationId = uuidv4();
  const sourceKeypair = getWalletKeypair(); // Main wallet

  try {
    // Pre-check balance
    const balanceCheck = await checkSufficientBalance(sourceKeypair, amount, token);
    if (!balanceCheck.sufficient) {
      return { success: false, error: balanceCheck.error };
    }

    // Determine target wallet
    let tradingWallet;
    if (targetWalletId) {
      tradingWallet = getTradingWallet(targetWalletId);
      if (!tradingWallet) {
        return { success: false, error: 'Target wallet not found' };
      }
    } else {
      tradingWallet = createTradingWallet(`Privacy-${Date.now()}`);
    }

    // Create pending operation
    const pendingOp: PendingOperation = {
      operationId,
      amount,
      token,
      targetWalletId: tradingWallet.id,
      targetWalletAddress: tradingWallet.address,
      sourceWalletAddress: sourceKeypair.publicKey.toBase58(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      zkProof: true,
    };
    pendingOperations.set(operationId, pendingOp);
    saveOperations();

    console.log(`[Privacy Background] Started ZK shielded operation ${operationId}`);

    // Execute in background (don't await)
    executeBackgroundShieldedTransfer(operationId, sourceKeypair, tradingWallet, amount, token);

    return { success: true, operationId };
  } catch (error: any) {
    console.error('[Privacy Background] Start error:', error.message);
    return { success: false, error: error.message };
  }
}

async function executeBackgroundShieldedTransfer(
  operationId: string,
  sourceKeypair: Keypair,
  tradingWallet: { id: string; address: string },
  amount: number,
  token: 'sol' | 'usdc'
): Promise<void> {
  try {
    const result = await privacyTransfer(sourceKeypair, amount, token, tradingWallet.id);

    if (result.success) {
      updateOperation(operationId, {
        status: 'completed',
        depositSignature: result.depositSignature,
        transferSignature: result.transferSignature,
        poolAddress: result.poolAddress,
      });
    } else {
      updateOperation(operationId, {
        status: 'failed',
        error: result.error,
      });
    }
  } catch (error: any) {
    console.error(`[Privacy Background ${operationId}] Error:`, error.message);
    updateOperation(operationId, { status: 'failed', error: error.message });
  }
}

/**
 * Get shielded pool balance for a wallet
 */
export async function getShieldedPoolBalance(
  walletAddress: string,
  token: 'sol' | 'usdc'
): Promise<{ available: number; deposited: number; poolAddress: string } | null> {
  try {
    const tokenSymbol = mapTokenToSymbol(token);
    const balance = await shadowWireClient.getBalance(walletAddress, tokenSymbol);

    return {
      available: TokenUtils.fromSmallestUnit(balance.available, tokenSymbol),
      deposited: TokenUtils.fromSmallestUnit(balance.deposited, tokenSymbol),
      poolAddress: balance.pool_address,
    };
  } catch (error: any) {
    console.error('[Privacy] Failed to get pool balance:', error.message);
    return null;
  }
}

// Get deposit status
export function getPrivacyDeposit(depositId: string): PrivacyDeposit | undefined {
  return privacyDeposits.get(depositId);
}

// List all privacy deposits
export function listPrivacyDeposits(): PrivacyDeposit[] {
  return Array.from(privacyDeposits.values());
}

// Get withdrawal status
export function getPrivacyWithdrawal(withdrawalId: string): PrivacyWithdrawal | undefined {
  return privacyWithdrawals.get(withdrawalId);
}

// List all privacy withdrawals
export function listPrivacyWithdrawals(): PrivacyWithdrawal[] {
  return Array.from(privacyWithdrawals.values());
}

// Get privacy pool status
export function getPrivacyPoolStatus(): {
  enabled: boolean;
  zkEnabled: boolean;
  zkError: string | null;
  totalDeposits: number;
  pendingDeposits: number;
  totalWithdrawals: number;
  pendingWithdrawals: number;
  failedOperations: number;
  fees: {
    sol: string;
    usdc: string;
  };
} {
  const deposits = listPrivacyDeposits();
  const withdrawals = listPrivacyWithdrawals();
  const failedOps = Array.from(pendingOperations.values()).filter(op => op.status === 'failed');

  return {
    enabled: true,
    zkEnabled: wasmInitialized,
    zkError: wasmInitializationError,
    totalDeposits: deposits.length,
    pendingDeposits: deposits.filter(d => d.status === 'pending').length,
    totalWithdrawals: withdrawals.length,
    pendingWithdrawals: withdrawals.filter(w => w.status === 'pending').length,
    failedOperations: failedOps.length,
    fees: {
      sol: `${SHADOWWIRE_FEES.SOL * 100}%`,
      usdc: `${SHADOWWIRE_FEES.USDC * 100}%`,
    },
  };
}

/**
 * Recover funds from a failed operation
 */
export async function recoverFailedOperation(operationId: string): Promise<{
  success: boolean;
  solRecovered?: number;
  usdcRecovered?: number;
  signature?: string;
  error?: string;
}> {
  const operation = pendingOperations.get(operationId);
  if (!operation) {
    return { success: false, error: 'Operation not found' };
  }

  if (operation.status !== 'failed') {
    return { success: false, error: `Operation status is ${operation.status}, not failed` };
  }

  try {
    // Check if funds are stuck in shielded pool
    const poolBalance = await getShieldedPoolBalance(operation.sourceWalletAddress, operation.token);

    if (poolBalance && poolBalance.available > 0) {
      console.log(`[Privacy Recovery] Found ${poolBalance.available} ${operation.token} in pool`);

      // Get source keypair
      const mainKeypair = getMainWalletKeypair();
      if (mainKeypair.publicKey.toBase58() !== operation.sourceWalletAddress) {
        return { success: false, error: 'Cannot recover - source wallet is not main wallet' };
      }

      // Withdraw from pool back to main wallet
      const withdrawResponse = await shadowWireClient.withdraw({
        wallet: operation.sourceWalletAddress,
        amount: TokenUtils.toSmallestUnit(poolBalance.available, mapTokenToSymbol(operation.token)),
        token_mint: operation.token === 'usdc' ? config.usdcMint : undefined,
      });

      if (withdrawResponse.success) {
        updateOperation(operationId, { status: 'completed' });
        return {
          success: true,
          [operation.token === 'sol' ? 'solRecovered' : 'usdcRecovered']: poolBalance.available,
          signature: withdrawResponse.tx_signature,
        };
      } else {
        return { success: false, error: withdrawResponse.error };
      }
    }

    return { success: false, error: 'No funds found in shielded pool to recover' };
  } catch (error: any) {
    console.error('[Privacy Recovery] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Recover funds stuck in a trading wallet's shielded pool
 * This handles cases where deposit to pool succeeded but external transfer failed
 */
export async function recoverFromTradingWalletPool(
  tradingWalletId: string,
  destinationAddress?: string
): Promise<{
  success: boolean;
  solRecovered?: number;
  usdcRecovered?: number;
  solSignature?: string;
  usdcSignature?: string;
  poolBalances?: { sol: number; usdc: number };
  error?: string;
}> {
  try {
    const tradingKeypair = getTradingWalletKeypair(tradingWalletId);
    if (!tradingKeypair) {
      return { success: false, error: 'Trading wallet not found' };
    }

    const tradingAddress = tradingKeypair.publicKey.toBase58();
    const destination = destinationAddress || getMainWalletKeypair().publicKey.toBase58();

    console.log(`[Pool Recovery] Checking shielded pool for wallet ${tradingWalletId}`);
    console.log(`[Pool Recovery] Destination: ${destination}`);

    // Check pool balances for both SOL and USDC
    const [solPoolBalance, usdcPoolBalance] = await Promise.all([
      getShieldedPoolBalance(tradingAddress, 'sol'),
      getShieldedPoolBalance(tradingAddress, 'usdc'),
    ]);

    const poolBalances = {
      sol: solPoolBalance?.available || 0,
      usdc: usdcPoolBalance?.available || 0,
    };

    console.log(`[Pool Recovery] Pool balances: SOL=${poolBalances.sol}, USDC=${poolBalances.usdc}`);

    if (poolBalances.sol === 0 && poolBalances.usdc === 0) {
      // Check on-chain balance as fallback
      const connection = getConnection();
      const onChainBalance = await connection.getBalance(tradingKeypair.publicKey) / LAMPORTS_PER_SOL;
      console.log(`[Pool Recovery] On-chain balance: ${onChainBalance} SOL`);

      if (onChainBalance > 0.01) {
        // Funds are on-chain, not in pool - use shielded transfer to maintain privacy
        console.log(`[Pool Recovery] Funds found on-chain, initiating shielded transfer...`);
        const transferAmount = onChainBalance - 0.005; // Keep some for pool deposit + transfer fees

        try {
          const shieldedResult = await executeShieldedWithdrawal(
            tradingKeypair,
            destination,
            transferAmount,
            'sol',
            connection
          );

          if (shieldedResult.success) {
            console.log(`[Pool Recovery] Shielded transfer complete: ${shieldedResult.transferSignature}`);
            return {
              success: true,
              solRecovered: transferAmount,
              solSignature: shieldedResult.transferSignature,
              poolBalances: { sol: 0, usdc: 0 },
            };
          } else {
            console.error(`[Pool Recovery] Shielded transfer failed: ${shieldedResult.error}`);
            return {
              success: false,
              poolBalances: { sol: 0, usdc: 0 },
              error: `Shielded transfer failed: ${shieldedResult.error}`,
            };
          }
        } catch (shieldedError: any) {
          console.error(`[Pool Recovery] Shielded transfer error: ${shieldedError.message}`);
          return {
            success: false,
            poolBalances: { sol: 0, usdc: 0 },
            error: `Shielded transfer error: ${shieldedError.message}`,
          };
        }
      }

      return {
        success: false,
        poolBalances,
        error: 'No funds found in shielded pool or on-chain',
      };
    }

    let solRecovered = 0;
    let usdcRecovered = 0;
    let solSignature: string | undefined;
    let usdcSignature: string | undefined;

    // Recover SOL from pool
    if (poolBalances.sol > 0) {
      console.log(`[Pool Recovery] Withdrawing ${poolBalances.sol} SOL from pool...`);
      try {
        const withdrawResponse = await shadowWireClient.withdraw({
          wallet: tradingAddress,
          amount: TokenUtils.toSmallestUnit(poolBalances.sol, 'SOL'),
          token_mint: undefined,
        });

        if (withdrawResponse.success && withdrawResponse.unsigned_tx_base64) {
          // Sign and send the withdrawal transaction
          const connection = getConnection();
          const txBuffer = Buffer.from(withdrawResponse.unsigned_tx_base64, 'base64');

          try {
            const versionedTx = VersionedTransaction.deserialize(txBuffer);
            versionedTx.sign([tradingKeypair]);
            solSignature = await connection.sendTransaction(versionedTx);
          } catch {
            const legacyTx = Transaction.from(txBuffer);
            legacyTx.sign(tradingKeypair);
            solSignature = await connection.sendTransaction(legacyTx, [tradingKeypair]);
          }

          await connection.confirmTransaction(solSignature, 'confirmed');
          solRecovered = poolBalances.sol;
          console.log(`[Pool Recovery] SOL withdrawn from pool: ${solSignature}`);

          // Now transfer to destination via shielded pool (maintains privacy)
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for balance to update

          const postBalance = await connection.getBalance(tradingKeypair.publicKey) / LAMPORTS_PER_SOL;
          if (postBalance > 0.01) {
            const transferAmount = postBalance - 0.005; // Keep some for pool fees
            console.log(`[Pool Recovery] Transferring ${transferAmount} SOL to destination via shielded pool...`);

            try {
              const shieldedResult = await executeShieldedWithdrawal(
                tradingKeypair,
                destination,
                transferAmount,
                'sol',
                connection
              );

              if (shieldedResult.success) {
                console.log(`[Pool Recovery] SOL shielded transfer complete: ${shieldedResult.transferSignature}`);
                solSignature = shieldedResult.transferSignature || solSignature;
              } else {
                console.error(`[Pool Recovery] SOL shielded transfer failed: ${shieldedResult.error}`);
                // Funds are on trading wallet - user can retry recovery
              }
            } catch (shieldedError: any) {
              console.error(`[Pool Recovery] SOL shielded transfer error: ${shieldedError.message}`);
              // Funds are on trading wallet - user can retry recovery
            }
          }
        } else {
          console.error(`[Pool Recovery] SOL withdraw failed: ${withdrawResponse.error}`);
        }
      } catch (e: any) {
        console.error(`[Pool Recovery] SOL recover error: ${e.message}`);
      }
    }

    // Recover USDC from pool
    if (poolBalances.usdc > 0) {
      console.log(`[Pool Recovery] Withdrawing ${poolBalances.usdc} USDC from pool...`);
      try {
        const withdrawResponse = await shadowWireClient.withdraw({
          wallet: tradingAddress,
          amount: TokenUtils.toSmallestUnit(poolBalances.usdc, 'USDC'),
          token_mint: config.usdcMint,
        });

        if (withdrawResponse.success && withdrawResponse.unsigned_tx_base64) {
          const connection = getConnection();
          const txBuffer = Buffer.from(withdrawResponse.unsigned_tx_base64, 'base64');

          try {
            const versionedTx = VersionedTransaction.deserialize(txBuffer);
            versionedTx.sign([tradingKeypair]);
            usdcSignature = await connection.sendTransaction(versionedTx);
          } catch {
            const legacyTx = Transaction.from(txBuffer);
            legacyTx.sign(tradingKeypair);
            usdcSignature = await connection.sendTransaction(legacyTx, [tradingKeypair]);
          }

          await connection.confirmTransaction(usdcSignature, 'confirmed');
          usdcRecovered = poolBalances.usdc;
          console.log(`[Pool Recovery] USDC withdrawn from pool: ${usdcSignature}`);

          // Now transfer USDC to destination via shielded pool (maintains privacy)
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for balance to update

          try {
            const usdcMint = new PublicKey(config.usdcMint);
            const sourceAta = await getAssociatedTokenAddress(usdcMint, tradingKeypair.publicKey);

            // Check USDC balance on trading wallet
            const tokenAccountInfo = await connection.getTokenAccountBalance(sourceAta);
            const usdcOnWallet = tokenAccountInfo.value.uiAmount || 0;

            if (usdcOnWallet > 0) {
              console.log(`[Pool Recovery] Transferring ${usdcOnWallet} USDC to destination via shielded pool...`);

              // Use shielded withdrawal to maintain privacy
              const shieldedResult = await executeShieldedWithdrawal(
                tradingKeypair,
                destination,
                usdcOnWallet,
                'usdc',
                connection
              );

              if (shieldedResult.success) {
                console.log(`[Pool Recovery] USDC shielded transfer complete: ${shieldedResult.transferSignature}`);
                usdcSignature = shieldedResult.transferSignature || usdcSignature;
              } else {
                console.error(`[Pool Recovery] USDC shielded transfer failed: ${shieldedResult.error}`);
                // Funds are on trading wallet - user can retry recovery
              }
            }
          } catch (transferError: any) {
            console.error(`[Pool Recovery] USDC shielded transfer failed: ${transferError.message}`);
            // USDC was withdrawn from pool but shielded transfer failed - it's on the trading wallet
            // User can retry recovery to complete the transfer
          }
        } else {
          console.error(`[Pool Recovery] USDC withdraw failed: ${withdrawResponse.error}`);
        }
      } catch (e: any) {
        console.error(`[Pool Recovery] USDC recover error: ${e.message}`);
      }
    }

    const success = solRecovered > 0 || usdcRecovered > 0;
    return {
      success,
      solRecovered: solRecovered > 0 ? solRecovered : undefined,
      usdcRecovered: usdcRecovered > 0 ? usdcRecovered : undefined,
      solSignature,
      usdcSignature,
      poolBalances,
      error: success ? undefined : 'Failed to recover funds from pool',
    };
  } catch (error: any) {
    console.error('[Pool Recovery] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check all trading wallets for stuck funds in shielded pools
 */
export async function scanAllPoolsForStuckFunds(): Promise<{
  walletsChecked: number;
  walletsWithFunds: Array<{
    walletId: string;
    walletAddress: string;
    solInPool: number;
    usdcInPool: number;
    solOnChain: number;
  }>;
}> {
  const wallets = await listTradingWallets();
  const connection = getConnection();
  const walletsWithFunds: Array<{
    walletId: string;
    walletAddress: string;
    solInPool: number;
    usdcInPool: number;
    solOnChain: number;
  }> = [];

  for (const wallet of wallets) {
    try {
      const keypair = getTradingWalletKeypair(wallet.id);
      if (!keypair) continue;

      const address = keypair.publicKey.toBase58();

      // Check pool balances
      const [solPool, usdcPool] = await Promise.all([
        getShieldedPoolBalance(address, 'sol'),
        getShieldedPoolBalance(address, 'usdc'),
      ]);

      // Check on-chain balance
      const onChainBalance = await connection.getBalance(keypair.publicKey) / LAMPORTS_PER_SOL;

      const solInPool = solPool?.available || 0;
      const usdcInPool = usdcPool?.available || 0;

      if (solInPool > 0 || usdcInPool > 0 || onChainBalance > 0.01) {
        walletsWithFunds.push({
          walletId: wallet.id,
          walletAddress: address,
          solInPool,
          usdcInPool,
          solOnChain: onChainBalance,
        });
      }
    } catch (e) {
      // Skip errored wallets
    }
  }

  return {
    walletsChecked: wallets.length,
    walletsWithFunds,
  };
}
