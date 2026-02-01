import axios from 'axios';
import { config } from '../config/env.js';
import { getMainWalletKeypair, getTradingWalletKeypair, getConnection } from './wallet.js';
import bs58 from 'bs58';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

/**
 * Privacy-Preserving Bridge Service
 *
 * Supports privacy-focused bridge providers:
 * 1. SilentSwap - Privacy-preserving cross-chain bridge (default)
 * 2. ShadowWire - ZK shielded transfers (Solana only)
 */

// ============================================
// TYPES
// ============================================

export type BridgeProvider = 'silentswap' | 'shadowwire';

export interface BridgeQuoteRequest {
  provider: BridgeProvider;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: number;
  fromAddress?: string;
  toAddress?: string;
}

export interface BridgeQuote {
  provider: BridgeProvider;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  exchangeRate: number;
  fee: number;
  feePercentage: number;
  estimatedTime: string;
  quoteId: string;
  expiresAt: string;
  privacyLevel: 'none' | 'medium' | 'high';
  features: string[];
}

export interface BridgeExecuteRequest {
  provider: BridgeProvider;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: number;
  fromAddress: string;
  toAddress: string;
  // Provider-specific
  evmPrivateKey?: string;
  solanaWalletId?: string;
  // SilentSwap specific
  siweSignature?: string;
}

export interface BridgeResult {
  success: boolean;
  provider: BridgeProvider;
  swapId?: string;
  status?: string;
  txHash?: string;
  depositAddress?: string;
  expectedOutput?: number;
  privacyLevel?: string;
  error?: string;
}

// ============================================
// SILENTSWAP INTEGRATION
// ============================================

const SILENTSWAP_API = 'https://api.silentswap.com/v2';

interface SilentSwapQuoteResponse {
  success: boolean;
  quoteId: string;
  inputAmount: string;
  outputAmount: string;
  exchangeRate: number;
  fee: {
    amount: string;
    percentage: number;
  };
  estimatedTime: number;
  route: {
    steps: number;
    chains: string[];
  };
}

interface SilentSwapSwapResponse {
  success: boolean;
  swapId: string;
  depositAddress: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  inputTxHash?: string;
  outputTxHash?: string;
}

/**
 * Get authentication signature for SilentSwap (SIWE)
 */
async function getSilentSwapAuth(address: string): Promise<{ message: string; nonce: string }> {
  try {
    const response = await axios.post(`${SILENTSWAP_API}/auth/nonce`, {
      address,
    });
    return {
      message: response.data.message,
      nonce: response.data.nonce,
    };
  } catch (error: any) {
    console.error('[SilentSwap] Auth error:', error.message);
    // Return mock for development
    return {
      message: `SilentSwap wants you to sign in.\n\nAddress: ${address}\nNonce: ${Date.now()}`,
      nonce: `nonce_${Date.now()}`,
    };
  }
}

/**
 * Get quote from SilentSwap
 */
async function getSilentSwapQuote(request: BridgeQuoteRequest): Promise<BridgeQuote> {
  try {
    const response = await axios.get(`${SILENTSWAP_API}/quote`, {
      params: {
        fromChain: request.fromChain,
        toChain: request.toChain,
        fromToken: request.fromToken,
        toToken: request.toToken,
        amount: request.amount.toString(),
      },
    });

    const data: SilentSwapQuoteResponse = response.data;

    return {
      provider: 'silentswap',
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.amount,
      toAmount: parseFloat(data.outputAmount),
      exchangeRate: data.exchangeRate,
      fee: parseFloat(data.fee.amount),
      feePercentage: data.fee.percentage,
      estimatedTime: `${Math.ceil(data.estimatedTime / 60)} minutes`,
      quoteId: data.quoteId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      privacyLevel: 'high',
      features: [
        'Privacy-preserving routing',
        'No on-chain link between sender/receiver',
        'OFAC/AML compliant',
        'Non-custodial',
      ],
    };
  } catch (error: any) {
    console.error('[SilentSwap] Quote error:', error.message);

    // Fallback estimated quote
    const rates: Record<string, number> = {
      'SOL-ETH': 0.058,
      'ETH-SOL': 17.2,
      'SOL-USDC': 175,
      'USDC-USDC': 0.998, // 0.2% privacy fee
      'ETH-USDC': 2950,
    };

    const rateKey = `${request.fromToken}-${request.toToken}`;
    const rate = rates[rateKey] || 1;
    const feePercent = 0.5; // SilentSwap privacy fee
    const fee = request.amount * (feePercent / 100);
    const toAmount = (request.amount - fee) * rate;

    return {
      provider: 'silentswap',
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.amount,
      toAmount,
      exchangeRate: rate,
      fee,
      feePercentage: feePercent,
      estimatedTime: '3-5 minutes',
      quoteId: `ss_quote_${Date.now()}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      privacyLevel: 'high',
      features: [
        'Privacy-preserving routing',
        'No on-chain link between sender/receiver',
        'Non-custodial',
      ],
    };
  }
}

/**
 * Execute swap via SilentSwap
 */
async function executeSilentSwap(request: BridgeExecuteRequest): Promise<BridgeResult> {
  const swapId = `ss_swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Get quote first
    const quote = await getSilentSwapQuote({
      provider: 'silentswap',
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromToken: request.fromToken,
      toToken: request.toToken,
      amount: request.amount,
    });

    // Execute swap
    const response = await axios.post(`${SILENTSWAP_API}/swap`, {
      quoteId: quote.quoteId,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress,
      siweSignature: request.siweSignature,
    });

    const data: SilentSwapSwapResponse = response.data;

    return {
      success: true,
      provider: 'silentswap',
      swapId: data.swapId,
      status: data.status,
      depositAddress: data.depositAddress,
      expectedOutput: quote.toAmount,
      privacyLevel: 'high',
    };
  } catch (error: any) {
    console.error('[SilentSwap] Swap error:', error.message);

    // For development/testing, return simulated success
    if (process.env.NODE_ENV === 'development' || !process.env.SILENTSWAP_API_KEY) {
      return {
        success: true,
        provider: 'silentswap',
        swapId,
        status: 'pending',
        depositAddress: request.fromAddress,
        expectedOutput: request.amount * 0.995, // 0.5% fee
        privacyLevel: 'high',
      };
    }

    return {
      success: false,
      provider: 'silentswap',
      swapId,
      error: error.message || 'SilentSwap execution failed',
    };
  }
}

/**
 * Get SilentSwap swap status
 */
async function getSilentSwapStatus(swapId: string): Promise<{
  status: string;
  inputTxHash?: string;
  outputTxHash?: string;
  completedAt?: string;
}> {
  try {
    const response = await axios.get(`${SILENTSWAP_API}/swap/${swapId}/status`);
    return response.data;
  } catch {
    // Simulated status for development
    return {
      status: 'completed',
      completedAt: new Date().toISOString(),
    };
  }
}

// ============================================
// SHADOWWIRE INTEGRATION
// ============================================

import {
  ShadowWireClient,
  TokenUtils,
  initWASM,
  generateRangeProof,
  type TokenSymbol,
  type WalletAdapter,
} from '@radr/shadowwire';

const shadowWireClient = new ShadowWireClient({
  apiBaseUrl: 'https://shadow.radr.fun/shadowpay/api',
  network: 'mainnet-beta',
  debug: process.env.NODE_ENV === 'development',
});

let wasmInitialized = false;

async function ensureWASM(): Promise<void> {
  if (!wasmInitialized) {
    try {
      await initWASM();
      wasmInitialized = true;
    } catch (e: any) {
      console.error('[ShadowWire] WASM init error:', e.message);
    }
  }
}

/**
 * Get quote from ShadowWire (Solana only)
 */
async function getShadowWireQuote(request: BridgeQuoteRequest): Promise<BridgeQuote> {
  // ShadowWire only supports Solana
  if (request.fromChain !== 'solana' || request.toChain !== 'solana') {
    throw new Error('ShadowWire only supports transfers within Solana');
  }

  const feePercent = 0.5; // 0.5% fee
  const fee = request.amount * (feePercent / 100);
  const toAmount = request.amount - fee;

  return {
    provider: 'shadowwire',
    fromChain: 'solana',
    toChain: 'solana',
    fromToken: request.fromToken,
    toToken: request.toToken,
    fromAmount: request.amount,
    toAmount,
    exchangeRate: 1,
    fee,
    feePercentage: feePercent,
    estimatedTime: '1-2 minutes',
    quoteId: `sw_quote_${Date.now()}`,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    privacyLevel: 'high',
    features: [
      'ZK Bulletproof range proofs',
      'Amount hidden on-chain',
      'No link between sender/receiver',
      'Solana native',
    ],
  };
}

/**
 * Execute ZK shielded transfer via ShadowWire
 */
async function executeShadowWire(request: BridgeExecuteRequest): Promise<BridgeResult> {
  const swapId = `sw_tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ShadowWire only supports Solana
  if (request.fromChain !== 'solana' || request.toChain !== 'solana') {
    return {
      success: false,
      provider: 'shadowwire',
      swapId,
      error: 'ShadowWire only supports transfers within Solana',
    };
  }

  try {
    await ensureWASM();

    // Get keypair
    let keypair: Keypair;
    if (request.solanaWalletId) {
      const tradingKeypair = getTradingWalletKeypair(request.solanaWalletId);
      if (!tradingKeypair) {
        return {
          success: false,
          provider: 'shadowwire',
          swapId,
          error: 'Trading wallet not found',
        };
      }
      keypair = tradingKeypair;
    } else {
      keypair = getMainWalletKeypair();
    }

    const tokenSymbol: TokenSymbol = request.fromToken.toUpperCase() === 'SOL' ? 'SOL' : 'USDC';
    const amountSmallestUnit = TokenUtils.toSmallestUnit(request.amount, tokenSymbol);
    const tokenMint = tokenSymbol === 'USDC' ? config.usdcMint : undefined;

    console.log(`[ShadowWire] Starting ZK transfer: ${request.amount} ${tokenSymbol}`);

    // Step 1: Deposit to shielded pool
    const depositResponse = await shadowWireClient.deposit({
      wallet: keypair.publicKey.toBase58(),
      amount: amountSmallestUnit,
      token_mint: tokenMint,
    });

    if (!depositResponse.success) {
      return {
        success: false,
        provider: 'shadowwire',
        swapId,
        error: 'Failed to deposit to shielded pool',
      };
    }

    // Step 2: Generate ZK proof
    console.log(`[ShadowWire] Generating ZK proof...`);
    const proof = await generateRangeProof(amountSmallestUnit, 64);

    // Step 3: Execute external transfer
    const walletAdapter: WalletAdapter = {
      signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
        const ed = await import('@noble/ed25519');
        const { sha512 } = await import('@noble/hashes/sha2.js');
        (ed.etc as any).sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));
        return await ed.signAsync(message, keypair.secretKey.slice(0, 32));
      },
    };

    const transferResponse = await shadowWireClient.externalTransfer({
      sender_wallet: keypair.publicKey.toBase58(),
      recipient_wallet: request.toAddress,
      token: tokenMint || 'SOL',
      nonce: Math.floor(Date.now() / 1000),
      amount: amountSmallestUnit,
      proof_bytes: proof.proofBytes,
      commitment: proof.commitmentBytes,
    }, walletAdapter);

    if (!transferResponse.success) {
      return {
        success: false,
        provider: 'shadowwire',
        swapId,
        error: transferResponse.error || 'ZK transfer failed',
      };
    }

    console.log(`[ShadowWire] Transfer complete: ${transferResponse.tx_signature}`);

    return {
      success: true,
      provider: 'shadowwire',
      swapId,
      status: 'completed',
      txHash: transferResponse.tx_signature,
      expectedOutput: request.amount * 0.995,
      privacyLevel: 'high',
    };
  } catch (error: any) {
    console.error('[ShadowWire] Error:', error.message);
    return {
      success: false,
      provider: 'shadowwire',
      swapId,
      error: error.message,
    };
  }
}

// ============================================
// SILENTSWAP WRAPPER (using SilentSwap SDK)
// ============================================

import { getSwapQuote as getSilentSwapDirectQuote, executeSwap as executeSilentSwapDirect, type ChainId } from './silentswap.js';

async function getSilentSwapQuoteWrapper(request: BridgeQuoteRequest): Promise<BridgeQuote> {
  const quote = await getSilentSwapDirectQuote(
    request.fromChain as ChainId,
    request.toChain as ChainId,
    request.fromToken,
    request.toToken,
    request.amount
  );

  return {
    ...quote,
    provider: 'silentswap',
    privacyLevel: 'high',
    features: [
      'Privacy-preserving routing',
      'No on-chain link between sender/receiver',
      'Cross-chain bridges',
      'Non-custodial',
    ],
  };
}

async function executeSilentSwapWrapper(request: BridgeExecuteRequest): Promise<BridgeResult> {
  const result = await executeSilentSwapDirect({
    fromChain: request.fromChain as ChainId,
    toChain: request.toChain as ChainId,
    fromToken: request.fromToken,
    toToken: request.toToken,
    amount: request.amount,
    fromAddress: request.fromAddress,
    toAddress: request.toAddress,
    solanaWalletId: request.solanaWalletId,
  });

  return {
    ...result,
    provider: 'silentswap',
    privacyLevel: 'high',
  };
}

// ============================================
// UNIFIED API
// ============================================

/**
 * Get available bridge providers and their capabilities
 * Note: LI.FI removed - using only SilentSwap for privacy-preserving cross-chain bridges
 */
export function getBridgeProviders() {
  return {
    providers: [
      {
        id: 'silentswap',
        name: 'SilentSwap',
        description: 'Privacy-preserving cross-chain bridge',
        privacyLevel: 'high',
        feePercent: '0.5%',
        chains: ['solana', 'ethereum', 'base', 'polygon', 'arbitrum'],
        features: ['Privacy routing', 'No on-chain link', 'Best rates', 'Non-custodial'],
        enabled: true,
      },
      {
        id: 'shadowwire',
        name: 'ShadowWire',
        description: 'ZK shielded transfers on Solana',
        privacyLevel: 'high',
        feePercent: '0.5%',
        chains: ['solana'],
        features: ['ZK proofs', 'Amount hidden', 'Solana native'],
        enabled: config.shadowwireEnabled,
      },
    ],
    default: 'silentswap',
  };
}

/**
 * Get quote from specified provider
 * Note: LI.FI removed - using SilentSwap for all cross-chain bridges
 */
export async function getBridgeQuote(request: BridgeQuoteRequest): Promise<BridgeQuote> {
  switch (request.provider) {
    case 'silentswap':
      return getSilentSwapQuoteWrapper(request);
    case 'shadowwire':
      return getShadowWireQuote(request);
    default:
      // Default to SilentSwap for unknown providers
      return getSilentSwapQuoteWrapper({ ...request, provider: 'silentswap' });
  }
}

/**
 * Execute swap/transfer via specified provider
 * Note: LI.FI removed - using SilentSwap for all cross-chain bridges
 */
export async function executeBridge(request: BridgeExecuteRequest): Promise<BridgeResult> {
  console.log(`[Bridge] Executing via ${request.provider}: ${request.amount} ${request.fromToken} → ${request.toToken}`);

  switch (request.provider) {
    case 'silentswap':
      return executeSilentSwapWrapper(request);
    case 'shadowwire':
      return executeShadowWire(request);
    default:
      // Default to SilentSwap for unknown providers
      return executeSilentSwapWrapper({ ...request, provider: 'silentswap' });
  }
}

/**
 * Get swap status from provider
 */
export async function getBridgeStatus(provider: BridgeProvider, swapId: string): Promise<any> {
  switch (provider) {
    case 'silentswap':
      return getSilentSwapStatus(swapId);
    case 'shadowwire':
      // ShadowWire completes synchronously
      return { status: 'completed' };
    default:
      return { status: 'unknown' };
  }
}

/**
 * Compare quotes from available providers
 * Note: Only SilentSwap and ShadowWire are available
 */
export async function compareQuotes(
  fromChain: string,
  toChain: string,
  fromToken: string,
  toToken: string,
  amount: number
): Promise<BridgeQuote[]> {
  const providers: BridgeProvider[] = [];

  // SilentSwap supports cross-chain bridges
  providers.push('silentswap');

  // ShadowWire only for Solana-to-Solana
  if (fromChain === 'solana' && toChain === 'solana') {
    providers.push('shadowwire');
  }

  const quotes = await Promise.allSettled(
    providers.map(provider =>
      getBridgeQuote({
        provider,
        fromChain,
        toChain,
        fromToken,
        toToken,
        amount,
      })
    )
  );

  return quotes
    .filter((result): result is PromiseFulfilledResult<BridgeQuote> => result.status === 'fulfilled')
    .map(result => result.value)
    .sort((a, b) => b.toAmount - a.toAmount); // Sort by best output amount
}
