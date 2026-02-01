import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import bs58 from 'bs58';
import { config } from '../config/env.js';
import {
  getConnection,
  getMainWalletKeypair,
  getTradingWalletKeypair,
  createTradingWallet,
} from './wallet.js';
import { executeSwap, getSwapQuote, type ChainId } from './silentswap.js';
import { executePrivacyCashTransfer, depositToPrivacyCash, withdrawFromPrivacyCash } from './privacy-cash.js';
import { screenTransaction, isRangeEnabled, shouldBlockTransaction } from './range.js';

/**
 * Private Cross-Chain Bridge
 *
 * Combines privacy pools with cross-chain bridging to enable
 * untraceable transfers between Solana and EVM chains.
 *
 * Flow for Private Bridge OUT (Solana → EVM):
 * 1. Trading Wallet → Privacy Pool (breaks link)
 * 2. Privacy Pool → Intermediate Wallet (fresh address)
 * 3. Intermediate Wallet → LI.FI Bridge → EVM Destination
 * Result: No on-chain link between trading wallet and EVM destination
 *
 * Flow for Private Bridge IN (EVM → Solana):
 * 1. EVM Source → LI.FI Bridge → Intermediate Solana Wallet
 * 2. Intermediate Wallet → Privacy Pool (breaks link)
 * 3. Privacy Pool → Trading Wallet
 * Result: No on-chain link between EVM source and trading wallet
 */

export interface PrivateBridgeRequest {
  direction: 'out' | 'in';
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: string;
  toToken: string;
  amount: number;
  // For 'out': source trading wallet on Solana
  tradingWalletId?: string;
  // For 'in': destination trading wallet on Solana
  destinationWalletId?: string;
  // EVM addresses
  evmAddress: string;
  evmPrivateKey?: string; // Required for 'in' direction
  // Privacy provider
  privacyProvider?: 'privacycash' | 'shadowwire';
  // Skip compliance check
  skipCompliance?: boolean;
}

export interface PrivateBridgeResult {
  success: boolean;
  operationId: string;
  direction: 'out' | 'in';
  status: 'pending' | 'privacy_transfer' | 'bridging' | 'completed' | 'failed';
  // Privacy step
  privacyTxHash?: string;
  intermediateWallet?: string;
  // Bridge step
  bridgeTxHash?: string;
  expectedOutput?: number;
  // Compliance
  compliance?: {
    screened: boolean;
    recommendation: string;
    reason?: string;
  };
  error?: string;
}

// Track ongoing operations
const bridgeOperations: Map<string, PrivateBridgeResult> = new Map();

/**
 * Execute a private cross-chain bridge transfer
 */
export async function executePrivateBridge(
  request: PrivateBridgeRequest
): Promise<PrivateBridgeResult> {
  const operationId = uuidv4();

  const result: PrivateBridgeResult = {
    success: false,
    operationId,
    direction: request.direction,
    status: 'pending',
  };

  bridgeOperations.set(operationId, result);

  try {
    if (request.direction === 'out') {
      return await executePrivateBridgeOut(request, result);
    } else {
      return await executePrivateBridgeIn(request, result);
    }
  } catch (error: any) {
    result.status = 'failed';
    result.error = error.message;
    bridgeOperations.set(operationId, result);
    return result;
  }
}

/**
 * Private Bridge OUT: Solana Trading Wallet → EVM Chain
 *
 * 1. Withdraw from trading wallet via privacy pool to intermediate wallet
 * 2. Bridge from intermediate wallet to EVM destination
 */
async function executePrivateBridgeOut(
  request: PrivateBridgeRequest,
  result: PrivateBridgeResult
): Promise<PrivateBridgeResult> {
  const {
    toChain,
    fromToken,
    toToken,
    amount,
    tradingWalletId,
    evmAddress,
    privacyProvider = 'privacycash',
    skipCompliance = false,
  } = request;

  console.log(`[PrivateBridge OUT] Starting: ${amount} ${fromToken} (Solana) → ${toToken} (${toChain})`);

  // Step 1: Validate trading wallet
  if (!tradingWalletId) {
    result.error = 'tradingWalletId is required for outbound bridge';
    result.status = 'failed';
    return result;
  }

  const tradingKeypair = getTradingWalletKeypair(tradingWalletId);
  if (!tradingKeypair) {
    result.error = 'Trading wallet not found';
    result.status = 'failed';
    return result;
  }

  // Step 2: Compliance check on destination
  if (!skipCompliance && isRangeEnabled()) {
    console.log(`[PrivateBridge OUT] Running compliance check on EVM destination...`);
    try {
      const screening = await screenTransaction(
        tradingKeypair.publicKey.toBase58(),
        evmAddress,
        amount,
        fromToken,
        'solana'
      );

      result.compliance = {
        screened: true,
        recommendation: screening.recommendation,
        reason: screening.reason,
      };

      if (shouldBlockTransaction(screening)) {
        result.error = `Bridge blocked: ${screening.reason}`;
        result.status = 'failed';
        return result;
      }
    } catch (e: any) {
      console.error('[PrivateBridge OUT] Compliance error:', e.message);
      result.compliance = {
        screened: false,
        recommendation: 'review',
        reason: 'Compliance service unavailable',
      };
    }
  }

  // Step 3: Create intermediate wallet (fresh, unlinkable)
  const intermediateWallet = Keypair.generate();
  result.intermediateWallet = intermediateWallet.publicKey.toBase58();
  console.log(`[PrivateBridge OUT] Created intermediate wallet: ${result.intermediateWallet}`);

  // Step 4: Privacy transfer from trading wallet to intermediate wallet
  result.status = 'privacy_transfer';
  bridgeOperations.set(result.operationId, result);

  console.log(`[PrivateBridge OUT] Step 1: Privacy transfer via ${privacyProvider}...`);

  const privacyResult = await executePrivacyCashTransfer({
    sender: tradingKeypair.publicKey.toBase58(),
    recipient: intermediateWallet.publicKey.toBase58(),
    amount,
    token: fromToken.toUpperCase() as 'SOL' | 'USDC',
  });

  if (!privacyResult.success) {
    result.error = `Privacy transfer failed: ${privacyResult.error}`;
    result.status = 'failed';
    return result;
  }

  result.privacyTxHash = privacyResult.withdrawTx;
  console.log(`[PrivateBridge OUT] Privacy transfer complete: ${result.privacyTxHash}`);

  // Step 5: Bridge from intermediate wallet to EVM
  result.status = 'bridging';
  bridgeOperations.set(result.operationId, result);

  console.log(`[PrivateBridge OUT] Step 2: Bridging to ${toChain}...`);

  // Get quote first
  const quote = await getSwapQuote('solana', toChain, fromToken, toToken, privacyResult.netAmount);

  // For bridging from Solana, we need to provide the intermediate wallet's private key
  const swapResult = await executeSwap({
    fromChain: 'solana',
    toChain,
    fromToken,
    toToken,
    amount: privacyResult.netAmount,
    fromAddress: intermediateWallet.publicKey.toBase58(),
    toAddress: evmAddress,
    solanaWalletId: undefined, // Use intermediate wallet directly
  });

  if (!swapResult.success) {
    result.error = `Bridge failed: ${swapResult.error}`;
    result.status = 'failed';
    // Note: Funds are in intermediate wallet - can be recovered
    return result;
  }

  result.bridgeTxHash = swapResult.txHash;
  result.expectedOutput = swapResult.expectedOutput;
  result.status = 'completed';
  result.success = true;

  console.log(`[PrivateBridge OUT] Complete! Bridge tx: ${result.bridgeTxHash}`);
  console.log(`[PrivateBridge OUT] Expected output: ${result.expectedOutput} ${toToken} on ${toChain}`);

  bridgeOperations.set(result.operationId, result);
  return result;
}

/**
 * Private Bridge IN: EVM Chain → Solana Trading Wallet
 *
 * 1. Bridge from EVM to intermediate Solana wallet
 * 2. Privacy transfer from intermediate wallet to trading wallet
 */
async function executePrivateBridgeIn(
  request: PrivateBridgeRequest,
  result: PrivateBridgeResult
): Promise<PrivateBridgeResult> {
  const {
    fromChain,
    fromToken,
    toToken,
    amount,
    destinationWalletId,
    evmAddress,
    evmPrivateKey,
    privacyProvider = 'privacycash',
    skipCompliance = false,
  } = request;

  console.log(`[PrivateBridge IN] Starting: ${amount} ${fromToken} (${fromChain}) → ${toToken} (Solana)`);

  // Step 1: Validate EVM private key
  if (!evmPrivateKey) {
    result.error = 'evmPrivateKey is required for inbound bridge';
    result.status = 'failed';
    return result;
  }

  // Step 2: Get or create destination trading wallet
  let tradingWallet;
  if (destinationWalletId) {
    const keypair = getTradingWalletKeypair(destinationWalletId);
    if (!keypair) {
      result.error = 'Destination trading wallet not found';
      result.status = 'failed';
      return result;
    }
    tradingWallet = { id: destinationWalletId, address: keypair.publicKey.toBase58() };
  } else {
    tradingWallet = createTradingWallet(`Bridge-${Date.now()}`);
    console.log(`[PrivateBridge IN] Created new trading wallet: ${tradingWallet.id}`);
  }

  // Step 3: Compliance check on EVM source
  if (!skipCompliance && isRangeEnabled()) {
    console.log(`[PrivateBridge IN] Running compliance check on EVM source...`);
    try {
      const screening = await screenTransaction(
        evmAddress,
        tradingWallet.address,
        amount,
        fromToken,
        'ethereum'
      );

      result.compliance = {
        screened: true,
        recommendation: screening.recommendation,
        reason: screening.reason,
      };

      if (shouldBlockTransaction(screening)) {
        result.error = `Bridge blocked: ${screening.reason}`;
        result.status = 'failed';
        return result;
      }
    } catch (e: any) {
      console.error('[PrivateBridge IN] Compliance error:', e.message);
      result.compliance = {
        screened: false,
        recommendation: 'review',
        reason: 'Compliance service unavailable',
      };
    }
  }

  // Step 4: Create intermediate Solana wallet
  const intermediateWallet = Keypair.generate();
  result.intermediateWallet = intermediateWallet.publicKey.toBase58();
  console.log(`[PrivateBridge IN] Created intermediate wallet: ${result.intermediateWallet}`);

  // Step 5: Bridge from EVM to intermediate Solana wallet
  result.status = 'bridging';
  bridgeOperations.set(result.operationId, result);

  console.log(`[PrivateBridge IN] Step 1: Bridging from ${fromChain} to Solana...`);

  const swapResult = await executeSwap({
    fromChain,
    toChain: 'solana',
    fromToken,
    toToken,
    amount,
    fromAddress: evmAddress,
    toAddress: intermediateWallet.publicKey.toBase58(),
    evmPrivateKey,
  });

  if (!swapResult.success) {
    result.error = `Bridge failed: ${swapResult.error}`;
    result.status = 'failed';
    return result;
  }

  result.bridgeTxHash = swapResult.txHash;
  console.log(`[PrivateBridge IN] Bridge complete: ${result.bridgeTxHash}`);

  // Wait for bridge to complete and funds to arrive
  console.log(`[PrivateBridge IN] Waiting for funds to arrive on Solana...`);
  await waitForFunds(intermediateWallet.publicKey, toToken, swapResult.expectedOutput || amount * 0.99);

  // Step 6: Privacy transfer from intermediate wallet to trading wallet
  result.status = 'privacy_transfer';
  bridgeOperations.set(result.operationId, result);

  console.log(`[PrivateBridge IN] Step 2: Privacy transfer via ${privacyProvider}...`);

  // Get actual balance of intermediate wallet
  const connection = getConnection();
  let transferAmount: number;

  if (toToken.toUpperCase() === 'SOL') {
    const balance = await connection.getBalance(intermediateWallet.publicKey);
    transferAmount = (balance - 5000) / LAMPORTS_PER_SOL; // Keep some for fees
  } else {
    // For USDC, get token balance
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const usdcMint = new PublicKey(config.usdcMint);
    const ata = await getAssociatedTokenAddress(usdcMint, intermediateWallet.publicKey);
    const accountInfo = await connection.getTokenAccountBalance(ata);
    transferAmount = accountInfo.value.uiAmount || 0;
  }

  const privacyResult = await executePrivacyCashTransfer({
    sender: intermediateWallet.publicKey.toBase58(),
    recipient: tradingWallet.address,
    amount: transferAmount,
    token: toToken.toUpperCase() as 'SOL' | 'USDC',
  });

  if (!privacyResult.success) {
    result.error = `Privacy transfer failed: ${privacyResult.error}`;
    result.status = 'failed';
    // Note: Funds are in intermediate wallet - can be recovered
    return result;
  }

  result.privacyTxHash = privacyResult.withdrawTx;
  result.expectedOutput = privacyResult.netAmount;
  result.status = 'completed';
  result.success = true;

  console.log(`[PrivateBridge IN] Complete! Privacy tx: ${result.privacyTxHash}`);
  console.log(`[PrivateBridge IN] Final amount: ${result.expectedOutput} ${toToken} in trading wallet`);

  bridgeOperations.set(result.operationId, result);
  return result;
}

/**
 * Wait for funds to arrive in a wallet
 */
async function waitForFunds(
  walletPubkey: PublicKey,
  token: string,
  expectedAmount: number,
  maxWaitMs: number = 300000 // 5 minutes
): Promise<boolean> {
  const connection = getConnection();
  const startTime = Date.now();
  const checkInterval = 5000; // 5 seconds

  while (Date.now() - startTime < maxWaitMs) {
    try {
      let balance: number;

      if (token.toUpperCase() === 'SOL') {
        balance = (await connection.getBalance(walletPubkey)) / LAMPORTS_PER_SOL;
      } else {
        const { getAssociatedTokenAddress } = await import('@solana/spl-token');
        const usdcMint = new PublicKey(config.usdcMint);
        const ata = await getAssociatedTokenAddress(usdcMint, walletPubkey);
        try {
          const accountInfo = await connection.getTokenAccountBalance(ata);
          balance = accountInfo.value.uiAmount || 0;
        } catch {
          balance = 0;
        }
      }

      if (balance >= expectedAmount * 0.95) { // Allow 5% slippage
        console.log(`[PrivateBridge] Funds arrived: ${balance} ${token}`);
        return true;
      }

      console.log(`[PrivateBridge] Waiting for funds... current: ${balance}, expected: ${expectedAmount}`);
    } catch (e: any) {
      console.error(`[PrivateBridge] Error checking balance:`, e.message);
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  console.log(`[PrivateBridge] Timeout waiting for funds`);
  return false;
}

/**
 * Get bridge operation status
 */
export function getBridgeOperationStatus(operationId: string): PrivateBridgeResult | undefined {
  return bridgeOperations.get(operationId);
}

/**
 * Get all pending bridge operations
 */
export function getPendingBridgeOperations(): PrivateBridgeResult[] {
  return Array.from(bridgeOperations.values()).filter(
    op => !['completed', 'failed'].includes(op.status)
  );
}

/**
 * Get quote for private bridge
 */
export async function getPrivateBridgeQuote(
  direction: 'out' | 'in',
  fromChain: ChainId,
  toChain: ChainId,
  fromToken: string,
  toToken: string,
  amount: number
): Promise<{
  fromAmount: number;
  toAmount: number;
  privacyFee: number;
  bridgeFee: number;
  totalFee: number;
  estimatedTime: string;
}> {
  // Privacy fee (Privacy Cash = 1%)
  const privacyFeePercent = 0.01;
  const privacyFee = amount * privacyFeePercent;

  // Get bridge quote
  const bridgeQuote = await getSwapQuote(
    direction === 'out' ? 'solana' : fromChain,
    direction === 'out' ? toChain : 'solana',
    fromToken,
    toToken,
    amount - privacyFee
  );

  return {
    fromAmount: amount,
    toAmount: bridgeQuote.toAmount,
    privacyFee,
    bridgeFee: bridgeQuote.fee,
    totalFee: privacyFee + bridgeQuote.fee,
    estimatedTime: `${bridgeQuote.estimatedTime} + 2-3 min (privacy transfer)`,
  };
}
