import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  ShadowWireClient,
  TokenUtils,
  initWASM,
  generateRangeProof,
  type TokenSymbol,
  type WalletAdapter,
  type ZKProofData,
} from '@radr/shadowwire';
import { config } from '../config/env.js';
import { getConnection, getWalletKeypairByAddress } from './wallet.js';

// Initialize ShadowWire client for ZK shielded transfers
const shadowWireClient = new ShadowWireClient({
  apiBaseUrl: 'https://shadow.radr.fun/shadowpay/api',
  network: 'mainnet-beta',
  debug: process.env.NODE_ENV === 'development',
});

// Track WASM initialization
let wasmInitialized = false;

// Cache ed25519 configuration
let ed25519Configured = false;

/**
 * Initialize WASM for ZK proof generation
 */
async function ensureWASMInitialized(): Promise<void> {
  if (!wasmInitialized) {
    try {
      await initWASM();
      wasmInitialized = true;
      console.log('[ShadowWire] WASM initialized for ZK proof generation');
    } catch (error: any) {
      console.error('[ShadowWire] Failed to initialize WASM:', error.message);
    }
  }
}

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
      await ensureEd25519Configured();
      const ed = await import('@noble/ed25519');
      const signature = await ed.signAsync(message, keypair.secretKey.slice(0, 32));
      return signature;
    },
  };
}

/**
 * Map token to ShadowWire token symbol
 */
function mapTokenToSymbol(token: string): TokenSymbol {
  switch (token.toUpperCase()) {
    case 'SOL': return 'SOL';
    case 'USDC': return 'USDC';
    case 'RADR': return 'RADR';
    case 'USD1': return 'USD1';
    default: return 'SOL';
  }
}

/**
 * Get token mint address
 */
function getTokenMint(token: string): string | undefined {
  switch (token.toUpperCase()) {
    case 'USDC': return config.usdcMint;
    case 'RADR': return 'RADRm1fDcbCkL2NxGSQF8RYBJYGwuiRx7bzWwvLtEFu'; // RADR token mint
    case 'USD1': return 'USD1fxVBKvMAxfxV97Q4HTykLFLvLdxWmQPQvTHN2Sou'; // USD1 token mint
    default: return undefined;
  }
}

export interface PrivateTransferParams {
  sender: string;
  recipient: string;
  amount: number;
  token: 'SOL' | 'USDC' | 'RADR' | 'USD1';
}

export interface PrivateTransferResult {
  success: boolean;
  txSignature?: string;
  depositSignature?: string;
  transferType: 'internal' | 'external';
  fee: number;
  netAmount: number;
  error?: string;
}

export interface BalanceInfo {
  wallet: string;
  available: number;
  deposited: number;
  token: string;
}

/**
 * Execute a private transfer using ShadowWire ZK shielded pool
 *
 * Flow:
 * 1. Sender deposits to ShadowWire shielded pool
 * 2. Generate ZK range proof
 * 3. Execute external transfer from pool to recipient
 *
 * Result: No on-chain link between sender and recipient
 */
export async function executePrivateTransfer(
  params: PrivateTransferParams
): Promise<PrivateTransferResult> {
  if (!config.shadowwireEnabled) {
    return {
      success: false,
      transferType: 'internal',
      fee: 0,
      netAmount: 0,
      error: 'ShadowWire is not enabled',
    };
  }

  const { sender, recipient, amount, token } = params;
  const tokenSymbol = mapTokenToSymbol(token);
  const connection = getConnection();

  // Initialize WASM
  await ensureWASMInitialized();

  // Calculate fees based on token type (from ShadowWire docs)
  // SOL: 0.5%, USDC: 1%, RADR: 0.3%, USD1: 1%
  const feeRates: Record<string, number> = {
    SOL: 0.005,
    USDC: 0.01,
    RADR: 0.003,
    USD1: 0.01,
  };
  const feePercentage = feeRates[token] || 0.01;
  const fee = amount * feePercentage;
  const netAmount = amount - fee;

  try {
    // Find sender wallet keypair by address (main wallet or trading wallets)
    const senderKeypair = getWalletKeypairByAddress(sender);
    if (!senderKeypair) {
      return {
        success: false,
        transferType: 'external',
        fee,
        netAmount,
        error: 'Sender wallet not found or not controlled by this backend',
      };
    }

    // Convert amount to smallest units
    const amountSmallestUnit = TokenUtils.toSmallestUnit(amount, tokenSymbol);
    const tokenMint = getTokenMint(token);

    console.log(`[ShadowWire] Starting ZK transfer: ${amount} ${token}`);
    console.log(`[ShadowWire] From: ${sender} To: ${recipient}`);

    // Step 1: Deposit to ShadowWire shielded pool
    console.log(`[ShadowWire] Step 1: Depositing to shielded pool...`);
    const depositResponse = await shadowWireClient.deposit({
      wallet: sender,
      amount: amountSmallestUnit,
      token_mint: tokenMint,
    });

    if (!depositResponse.success) {
      return {
        success: false,
        transferType: 'external',
        fee,
        netAmount,
        error: 'Failed to create deposit transaction',
      };
    }

    // Sign and send deposit transaction
    const depositTxBuffer = Buffer.from(depositResponse.unsigned_tx_base64, 'base64');
    let depositSignature: string;

    try {
      const versionedTx = VersionedTransaction.deserialize(depositTxBuffer);
      versionedTx.sign([senderKeypair]);
      depositSignature = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch {
      const legacyTx = Transaction.from(depositTxBuffer);
      legacyTx.sign(senderKeypair);
      depositSignature = await connection.sendTransaction(legacyTx, [senderKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    }

    console.log(`[ShadowWire] Deposit tx: ${depositSignature}`);
    await connection.confirmTransaction(depositSignature, 'confirmed');
    console.log(`[ShadowWire] Deposit confirmed`);

    // Wait for pool balance to update
    console.log(`[ShadowWire] Waiting for pool balance...`);
    const maxRetries = 10;
    const retryDelay = 2000;
    let poolReady = false;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const poolBalance = await shadowWireClient.getBalance(sender, tokenSymbol);
        if (poolBalance.available >= amountSmallestUnit) {
          console.log(`[ShadowWire] Pool balance ready: ${poolBalance.available}`);
          poolReady = true;
          break;
        }
      } catch (e: any) {
        console.log(`[ShadowWire] Pool check: ${e.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    if (!poolReady) {
      return {
        success: false,
        depositSignature,
        transferType: 'external',
        fee,
        netAmount,
        error: 'Pool balance not updated after deposit - please retry',
      };
    }

    // Step 2: Generate ZK range proof
    console.log(`[ShadowWire] Step 2: Generating ZK proof...`);
    let proof: ZKProofData;
    try {
      proof = await generateRangeProof(amountSmallestUnit, 64);
      console.log(`[ShadowWire] ZK proof generated (${proof.proofBytes.length} bytes)`);
    } catch (error: any) {
      return {
        success: false,
        depositSignature,
        transferType: 'external',
        fee,
        netAmount,
        error: `ZK proof generation failed: ${error.message}`,
      };
    }

    // Step 3: Execute external transfer with retry logic
    console.log(`[ShadowWire] Step 3: Executing ZK shielded transfer...`);
    const walletAdapter = createWalletAdapter(senderKeypair);

    // Retry config for handling "TX1 (upload proof) failed" errors
    const maxTransferRetries = 3;
    const transferRetryDelay = 5000; // 5 seconds
    let transferResponse: any;
    let lastTransferError: string | undefined;

    for (let attempt = 1; attempt <= maxTransferRetries; attempt++) {
      // Generate fresh nonce for each attempt
      const nonce = Math.floor(Date.now() / 1000);

      console.log(`[ShadowWire] Transfer attempt ${attempt}/${maxTransferRetries}...`);

      try {
        transferResponse = await shadowWireClient.externalTransfer({
          sender_wallet: sender,
          recipient_wallet: recipient,
          token: tokenMint || 'SOL',
          nonce,
          amount: amountSmallestUnit,
          proof_bytes: proof.proofBytes,
          commitment: proof.commitmentBytes,
        }, walletAdapter);

        if (transferResponse.success) {
          console.log(`[ShadowWire] Transfer succeeded on attempt ${attempt}`);
          break;
        }

        lastTransferError = transferResponse.error || 'ZK transfer failed';
        console.warn(`[ShadowWire] Transfer attempt ${attempt} failed: ${lastTransferError}`);

        // Check if it's a recoverable error (TX confirmation failure)
        const isRecoverable = lastTransferError &&
                              (lastTransferError.includes('TX1') ||
                               lastTransferError.includes('unable to confirm') ||
                               lastTransferError.includes('expired'));

        if (!isRecoverable || attempt === maxTransferRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        const waitTime = transferRetryDelay * attempt;
        console.log(`[ShadowWire] Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));

      } catch (e: any) {
        lastTransferError = e.message || 'Transfer exception';
        console.error(`[ShadowWire] Transfer attempt ${attempt} exception:`, e.message);

        if (attempt < maxTransferRetries) {
          const waitTime = transferRetryDelay * attempt;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    if (!transferResponse?.success) {
      // Transfer failed - attempt automatic recovery
      console.log(`[ShadowWire] Transfer failed, attempting automatic fund recovery...`);

      try {
        const recoveryResult = await executeWithdrawal(sender, amount, token);
        if (recoveryResult.success) {
          console.log(`[ShadowWire] Funds recovered: ${recoveryResult.amountWithdrawn} ${token}`);
          return {
            success: false,
            depositSignature,
            transferType: 'external',
            fee,
            netAmount,
            error: `${lastTransferError}. Funds automatically recovered to sender wallet.`,
          };
        }
      } catch (recoveryError: any) {
        console.error(`[ShadowWire] Auto-recovery failed:`, recoveryError.message);
      }

      return {
        success: false,
        depositSignature,
        transferType: 'external',
        fee,
        netAmount,
        error: lastTransferError || 'ZK transfer failed after retries',
      };
    }

    console.log(`[ShadowWire] Transfer complete: ${transferResponse.tx_signature}`);

    return {
      success: true,
      depositSignature,
      txSignature: transferResponse.tx_signature,
      transferType: 'external',
      fee,
      netAmount,
    };
  } catch (error) {
    console.error('[ShadowWire] Transfer error:', error);
    return {
      success: false,
      transferType: 'external',
      fee,
      netAmount,
      error: error instanceof Error ? error.message : 'Transfer failed',
    };
  }
}

/**
 * Get privacy pool balance for a wallet
 */
export async function getPrivacyBalance(
  wallet: string,
  token: 'SOL' | 'USDC' | 'RADR' | 'USD1' = 'SOL'
): Promise<BalanceInfo> {
  const tokenSymbol = mapTokenToSymbol(token);
  const balance = await shadowWireClient.getBalance(wallet, tokenSymbol);

  return {
    wallet: balance.wallet,
    available: TokenUtils.fromSmallestUnit(balance.available, tokenSymbol),
    deposited: TokenUtils.fromSmallestUnit(balance.deposited, tokenSymbol),
    token,
  };
}

/**
 * Create deposit transaction for funding privacy pool
 */
export async function createDepositTransaction(
  wallet: string,
  amount: number,
  token: 'SOL' | 'USDC' | 'RADR' | 'USD1' = 'SOL'
) {
  const tokenSymbol = mapTokenToSymbol(token);
  const amountSmallest = TokenUtils.toSmallestUnit(amount, tokenSymbol);
  const tokenMint = getTokenMint(token);

  const response = await shadowWireClient.deposit({
    wallet,
    amount: amountSmallest,
    token_mint: tokenMint,
  });

  return {
    success: response.success,
    unsignedTx: response.unsigned_tx_base64,
    poolAddress: response.pool_address,
    amount,
    token,
  };
}

/**
 * Create withdrawal transaction from privacy pool
 */
export async function createWithdrawTransaction(
  wallet: string,
  amount: number,
  token: 'SOL' | 'USDC' | 'RADR' | 'USD1' = 'SOL'
) {
  const tokenSymbol = mapTokenToSymbol(token);
  const amountSmallest = TokenUtils.toSmallestUnit(amount, tokenSymbol);
  const tokenMint = getTokenMint(token);

  const response = await shadowWireClient.withdraw({
    wallet,
    amount: amountSmallest,
    token_mint: tokenMint,
  });

  return {
    success: response.success,
    unsignedTx: response.unsigned_tx_base64,
    amountWithdrawn: TokenUtils.fromSmallestUnit(response.amount_withdrawn || 0, tokenSymbol),
    fee: TokenUtils.fromSmallestUnit(response.fee || 0, tokenSymbol),
    token,
  };
}

// Fee rates from ShadowWire SDK documentation
const FEE_RATES: Record<string, number> = {
  SOL: 0.005,   // 0.5%
  USDC: 0.01,   // 1%
  RADR: 0.003,  // 0.3%
  USD1: 0.01,   // 1%
};

/**
 * Get fee information for a token
 */
export function getTransferFeeInfo(token: 'SOL' | 'USDC' | 'RADR' | 'USD1' = 'SOL') {
  const feePercentage = FEE_RATES[token] || 0.01;
  const minimumAmounts: Record<string, number> = {
    SOL: 0.01,
    USDC: 0.10,
    RADR: 1,
    USD1: 0.10,
  };

  return {
    feePercentage: feePercentage * 100, // Return as percentage
    minimumAmount: minimumAmounts[token] || 0.01,
    token,
  };
}

/**
 * Calculate fee breakdown for an amount
 */
export function calculateTransferFee(amount: number, token: 'SOL' | 'USDC' | 'RADR' | 'USD1' = 'SOL') {
  const feePercentage = FEE_RATES[token] || 0.01;
  const fee = amount * feePercentage;
  const netAmount = amount - fee;

  return {
    amount,
    fee,
    feePercentage: feePercentage * 100, // Return as percentage
    netAmount,
    token,
  };
}

/**
 * Pay AI agent using privacy-preserving transfer
 * Used when user interacts with AI agent - pays 1 USD1 token
 */
export async function payAIAgent(
  userWallet: string,
  agentWallet: string,
  amount: number = 1
): Promise<PrivateTransferResult> {
  return executePrivateTransfer({
    sender: userWallet,
    recipient: agentWallet,
    amount,
    token: 'USD1',
  });
}

/**
 * Execute a signed withdrawal from the privacy pool back to the wallet
 * This is used to recover funds stuck in the pool after a failed transfer
 */
export async function executeWithdrawal(
  wallet: string,
  amount: number,
  token: 'SOL' | 'USDC' | 'RADR' | 'USD1' = 'SOL'
): Promise<{
  success: boolean;
  signature?: string;
  amountWithdrawn: number;
  error?: string;
}> {
  const tokenSymbol = mapTokenToSymbol(token);
  const amountSmallest = TokenUtils.toSmallestUnit(amount, tokenSymbol);
  const tokenMint = getTokenMint(token);
  const connection = getConnection();

  try {
    // Get the keypair for the wallet
    const walletKeypair = getWalletKeypairByAddress(wallet);
    if (!walletKeypair) {
      return {
        success: false,
        amountWithdrawn: 0,
        error: 'Wallet not found or not controlled by this backend',
      };
    }

    console.log(`[ShadowWire] Executing withdrawal: ${amount} ${token} to ${wallet}`);

    // Create withdrawal transaction
    const response = await shadowWireClient.withdraw({
      wallet,
      amount: amountSmallest,
      token_mint: tokenMint,
    });

    if (!response.success || !response.unsigned_tx_base64) {
      return {
        success: false,
        amountWithdrawn: 0,
        error: response.error || 'Failed to create withdrawal transaction',
      };
    }

    // Sign and send the transaction
    const txBuffer = Buffer.from(response.unsigned_tx_base64, 'base64');
    let signature: string;

    try {
      const versionedTx = VersionedTransaction.deserialize(txBuffer);
      versionedTx.sign([walletKeypair]);
      signature = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch {
      const legacyTx = Transaction.from(txBuffer);
      legacyTx.sign(walletKeypair);
      signature = await connection.sendTransaction(legacyTx, [walletKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    }

    console.log(`[ShadowWire] Withdrawal tx sent: ${signature}`);
    await connection.confirmTransaction(signature, 'confirmed');
    console.log(`[ShadowWire] Withdrawal confirmed`);

    const amountWithdrawn = TokenUtils.fromSmallestUnit(response.amount_withdrawn || amountSmallest, tokenSymbol);

    return {
      success: true,
      signature,
      amountWithdrawn,
    };
  } catch (error) {
    console.error('[ShadowWire] Withdrawal error:', error);
    return {
      success: false,
      amountWithdrawn: 0,
      error: error instanceof Error ? error.message : 'Withdrawal failed',
    };
  }
}

export { shadowWireClient, TokenUtils };
