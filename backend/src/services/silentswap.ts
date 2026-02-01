import { config } from '../config/env.js';
import {
  getBridgeQuote as getSilentSwapQuote,
  convertQuoteResultToQuote,
  executeBridgeTransaction,
  getBridgeStatus as getSilentSwapBridgeStatus,
  type BridgeProvider,
  type BridgeStatus,
} from '@silentswap/sdk';
import { createWalletClient, http, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, base, polygon, arbitrum, bsc, Chain } from 'viem/chains';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { getMainWalletKeypair, getTradingWalletKeypair, getConnection } from './wallet.js';
import { Keypair, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';

// Chain ID mapping (using SilentSwap SDK chain IDs)
const CHAIN_IDS: Record<string, number> = {
  solana: 7565164, // SilentSwap SDK Solana chain ID
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  bsc: 56,
};

// Chain objects for viem
const VIEM_CHAINS: Record<number, Chain> = {
  1: mainnet,
  8453: base,
  137: polygon,
  42161: arbitrum,
  56: bsc,
};

// Native token addresses
const NATIVE_TOKENS: Record<string, string> = {
  solana: 'So11111111111111111111111111111111111111112', // Wrapped SOL
  ethereum: '0x0000000000000000000000000000000000000000',
  base: '0x0000000000000000000000000000000000000000',
  polygon: '0x0000000000000000000000000000000000000000',
  arbitrum: '0x0000000000000000000000000000000000000000',
  bsc: '0x0000000000000000000000000000000000000000',
};

// USDC addresses per chain
const USDC_ADDRESSES: Record<string, string> = {
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  bsc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

// Supported chains
export const SUPPORTED_CHAINS = {
  solana: { id: 'solana', name: 'Solana', nativeToken: 'SOL', chainId: CHAIN_IDS.solana },
  ethereum: { id: 'ethereum', name: 'Ethereum', nativeToken: 'ETH', chainId: CHAIN_IDS.ethereum },
  base: { id: 'base', name: 'Base', nativeToken: 'ETH', chainId: CHAIN_IDS.base },
  polygon: { id: 'polygon', name: 'Polygon', nativeToken: 'MATIC', chainId: CHAIN_IDS.polygon },
  arbitrum: { id: 'arbitrum', name: 'Arbitrum', nativeToken: 'ETH', chainId: CHAIN_IDS.arbitrum },
  bsc: { id: 'bsc', name: 'BNB Chain', nativeToken: 'BNB', chainId: CHAIN_IDS.bsc },
} as const;

export type ChainId = keyof typeof SUPPORTED_CHAINS;

// Supported tokens per chain
export const SUPPORTED_TOKENS: Record<ChainId, string[]> = {
  solana: ['SOL', 'USDC'],
  ethereum: ['ETH', 'USDC', 'USDT'],
  base: ['ETH', 'USDC'],
  polygon: ['MATIC', 'USDC', 'USDT'],
  arbitrum: ['ETH', 'USDC'],
  bsc: ['BNB', 'USDC'],
};

export interface SwapQuote {
  fromChain: ChainId;
  toChain: ChainId;
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
  provider?: string;
  retentionRate?: number;
  slippage?: number;
}

export interface SwapRequest {
  fromChain: ChainId;
  toChain: ChainId;
  fromToken: string;
  toToken: string;
  amount: number;
  fromAddress: string;
  toAddress: string;
  solanaWalletId?: string; // Trading wallet ID for Solana
  evmPrivateKey?: string; // EVM private key for EVM source chains (not needed for Solana→EVM)
}

export interface SwapResult {
  success: boolean;
  swapId?: string;
  requestId?: string;
  status?: string;
  txHash?: string;
  txHashes?: string[];
  depositAddress?: string;
  depositAmount?: number;
  expectedOutput?: number;
  error?: string;
}

/**
 * SilentSwap is enabled when integrator ID is configured
 */
export function isSilentSwapEnabled(): boolean {
  return !!config.silentswapIntegratorId || true; // Always enabled as it works without API key
}

/**
 * Get supported chains and tokens
 */
export function getSupportedChainsAndTokens() {
  return {
    chains: Object.keys(SUPPORTED_CHAINS),
    tokens: SUPPORTED_TOKENS,
    config: {
      provider: 'silentswap',
      enabled: isSilentSwapEnabled(),
    },
  };
}

/**
 * Get token address for a given chain and token symbol
 */
function getTokenAddress(chain: ChainId, tokenSymbol: string): string {
  const symbol = tokenSymbol.toUpperCase();

  // Handle native tokens
  if (
    (chain === 'solana' && symbol === 'SOL') ||
    (chain === 'ethereum' && symbol === 'ETH') ||
    (chain === 'base' && symbol === 'ETH') ||
    (chain === 'polygon' && symbol === 'MATIC') ||
    (chain === 'arbitrum' && symbol === 'ETH') ||
    (chain === 'bsc' && symbol === 'BNB')
  ) {
    return NATIVE_TOKENS[chain];
  }

  // Handle USDC
  if (symbol === 'USDC') {
    return USDC_ADDRESSES[chain];
  }

  throw new Error(`Token ${tokenSymbol} not supported on ${chain}`);
}

/**
 * Convert amount to base units based on decimals
 */
function toBaseUnits(amount: number, decimals: number): string {
  const multiplier = BigInt(10 ** decimals);
  const amountBigInt = BigInt(Math.floor(amount * 10 ** decimals));
  return amountBigInt.toString();
}

/**
 * Get decimals for token on chain
 */
function getDecimals(chain: ChainId, tokenSymbol: string): number {
  if (tokenSymbol.toUpperCase() === 'USDC' || tokenSymbol.toUpperCase() === 'USDT') {
    return 6;
  }
  return chain === 'solana' ? 9 : 18;
}

/**
 * Get quote for cross-chain swap using SilentSwap SDK
 */
export async function getSwapQuote(
  fromChain: ChainId,
  toChain: ChainId,
  fromToken: string,
  toToken: string,
  amount: number
): Promise<SwapQuote> {
  const fromChainId = CHAIN_IDS[fromChain];
  const toChainId = CHAIN_IDS[toChain];

  if (!fromChainId || !toChainId) {
    throw new Error(`Invalid chain: ${fromChain} or ${toChain}`);
  }

  const fromTokenAddress = getTokenAddress(fromChain, fromToken);
  const toTokenAddress = getTokenAddress(toChain, toToken);

  // Get token decimals
  const fromDecimals = getDecimals(fromChain, fromToken);
  const toDecimals = getDecimals(toChain, toToken);
  const fromAmountBaseUnits = toBaseUnits(amount, fromDecimals);

  // Placeholder address for quote (not needed for quote)
  const placeholderAddress = fromChain === 'solana'
    ? 'So11111111111111111111111111111111111111112'
    : '0x0000000000000000000000000000000000000001';

  try {
    // Get quote from SilentSwap SDK
    const quoteResult = await getSilentSwapQuote(
      fromChainId,
      fromTokenAddress,
      fromAmountBaseUnits,
      toChainId,
      toTokenAddress,
      placeholderAddress as `0x${string}`
    );

    // Parse output amount
    const toAmount = Number(quoteResult.outputAmount) / 10 ** toDecimals;
    const exchangeRate = toAmount / amount;

    return {
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount,
      exchangeRate,
      fee: quoteResult.feeUsd,
      feePercentage: (1 - quoteResult.retentionRate) * 100,
      estimatedTime: `${Math.ceil(quoteResult.estimatedTime / 60)} minutes`,
      quoteId: `ss_quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      provider: quoteResult.provider,
      retentionRate: quoteResult.retentionRate,
      slippage: quoteResult.slippage,
    };
  } catch (error: any) {
    console.error('[SilentSwap] Quote error:', error.message);

    // Fallback to estimated quote if SilentSwap API fails
    const rates: Record<string, number> = {
      'SOL-ETH': 0.06,
      'ETH-SOL': 16.5,
      'SOL-MATIC': 120,
      'USDC-USDC': 0.995, // 0.5% fee
      'SOL-USDC': 180,
      'ETH-USDC': 3000,
      'MATIC-USDC': 0.9,
    };

    const rateKey = `${fromToken.toUpperCase()}-${toToken.toUpperCase()}`;
    const rate = rates[rateKey] || 1;
    const feePercentage = 0.5;
    const fee = amount * (feePercentage / 100);
    const toAmount = (amount - fee) * rate;

    return {
      fromChain,
      toChain,
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount,
      exchangeRate: rate,
      fee,
      feePercentage,
      estimatedTime: '5-10 minutes (estimated)',
      quoteId: `ss_quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }
}

/**
 * Execute cross-chain swap using SilentSwap SDK
 *
 * For Solana → EVM bridges:
 * - Uses Solana wallet to sign the source transaction
 * - EVM destination is just a receiving address (no signing needed)
 *
 * For EVM → Solana bridges:
 * - Would need EVM wallet to sign (not currently supported)
 */
export async function executeSwap(request: SwapRequest): Promise<SwapResult> {
  const { fromChain, toChain, fromToken, toToken, amount, fromAddress, toAddress, solanaWalletId } = request;

  const swapId = `ss_swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const fromChainId = CHAIN_IDS[fromChain];
    const toChainId = CHAIN_IDS[toChain];

    if (!fromChainId || !toChainId) {
      return { success: false, error: `Invalid chain: ${fromChain} or ${toChain}` };
    }

    const fromTokenAddress = getTokenAddress(fromChain, fromToken);
    const toTokenAddress = getTokenAddress(toChain, toToken);

    // Get token decimals
    const fromDecimals = getDecimals(fromChain, fromToken);
    const toDecimals = getDecimals(toChain, toToken);
    const fromAmountBaseUnits = toBaseUnits(amount, fromDecimals);

    console.log(`[SilentSwap] Starting bridge: ${amount} ${fromToken} (${fromChain}) -> ${toToken} (${toChain})`);
    console.log(`[SilentSwap] From: ${fromAddress} To: ${toAddress}`);

    // Try to get quote from SDK with fallback handling
    let quoteResult: any;
    let useFallback = false;

    try {
      // For Solana source: userAddress = Solana address, recipientAddress = EVM destination
      // For EVM source: userAddress = EVM address, recipientAddress = Solana destination (if applicable)
      const userAddr = fromChain === 'solana' ? fromAddress : fromAddress;
      const recipientAddr = fromChain === 'solana' ? toAddress : (toChain === 'solana' ? toAddress : undefined);

      console.log(`[SilentSwap] Getting quote: userAddr=${userAddr}, recipientAddr=${recipientAddr}`);

      quoteResult = await getSilentSwapQuote(
        fromChainId,
        fromTokenAddress,
        fromAmountBaseUnits,
        toChainId,
        toTokenAddress,
        userAddr as `0x${string}`, // User address (source chain format)
        undefined, // AbortSignal
        recipientAddr, // Recipient address (required for cross-chain)
        fromAddress // Source address
      );
      console.log(`[SilentSwap] Quote received: provider=${quoteResult.provider}, output=${quoteResult.outputAmount}`);
    } catch (quoteError: any) {
      console.warn(`[SilentSwap] SDK quote failed: ${quoteError.message}, using fallback`);
      useFallback = true;

      // Create a fallback estimated quote for development/testing
      const rates: Record<string, number> = {
        'SOL-ETH': 0.06,
        'ETH-SOL': 16.5,
        'SOL-MATIC': 120,
        'USDC-USDC': 0.995,
        'USDC-ETH': 0.00033,
        'SOL-USDC': 180,
        'ETH-USDC': 3000,
      };
      const rateKey = `${fromToken.toUpperCase()}-${toToken.toUpperCase()}`;
      const rate = rates[rateKey] || 1;
      const feePercent = 0.5;
      const fee = amount * (feePercent / 100);
      const estimatedOutput = (amount - fee) * rate;

      quoteResult = {
        provider: 'fallback',
        outputAmount: toBaseUnits(estimatedOutput, toDecimals),
        feeUsd: fee,
        retentionRate: 0.995,
        estimatedTime: 300, // 5 minutes
        slippage: 0.01,
      };
    }

    // Handle Solana source chains
    if (fromChain === 'solana') {
      // Get Solana keypair for signing
      let solanaKeypair: Keypair;
      if (solanaWalletId) {
        const tradingKeypair = getTradingWalletKeypair(solanaWalletId);
        if (!tradingKeypair) {
          return { success: false, error: 'Solana trading wallet not found' };
        }
        solanaKeypair = tradingKeypair;
      } else {
        solanaKeypair = getMainWalletKeypair();
      }

      console.log(`[SilentSwap] Using Solana wallet: ${solanaKeypair.publicKey.toBase58()}`);

      const toAmount = Number(quoteResult.outputAmount) / 10 ** toDecimals;

      // If using fallback (SDK unavailable), return error - we can't execute without a real quote
      if (useFallback) {
        console.warn(`[SilentSwap] SDK quote failed - cannot execute bridge without transaction data`);
        return {
          success: false,
          swapId,
          status: 'quote_failed',
          depositAmount: amount,
          expectedOutput: toAmount,
          error: 'Bridge quote failed. The SilentSwap bridge may be temporarily unavailable. Please try again later.',
        };
      }

      // Convert to executable quote
      const quote = convertQuoteResultToQuote(quoteResult, fromChainId);

      // For Solana → EVM, we sign with Solana wallet
      const connection = getConnection();

      // Create a minimal connector (not used for Solana → EVM but required by SDK)
      const connector = {
        switchChain: async ({ chainId }: { chainId: number }) => {
          console.log(`[SilentSwap] Chain switch requested to ${chainId}`);
        },
      } as any;

      // Create Solana transaction executor
      const solanaExecutor = async (tx: any): Promise<string> => {
        console.log(`[SilentSwap] Executing Solana transaction...`, JSON.stringify(tx, null, 2).substring(0, 500));

        const { Transaction: SolanaTransaction, PublicKey, TransactionInstruction, VersionedTransaction: SolanaVersionedTransaction } = await import('@solana/web3.js');

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

        let transaction: Transaction;

        // Handle DeBridge serialized transaction (just has data field, no instructions)
        if (tx.data && !tx.instructions) {
          console.log(`[SilentSwap] Deserializing DeBridge transaction...`);
          // DeBridge returns hex-encoded serialized transaction
          const txData = tx.data.startsWith('0x') ? tx.data.slice(2) : tx.data;
          const txBuffer = Buffer.from(txData, 'hex');

          // Try to deserialize as VersionedTransaction first, then legacy Transaction
          try {
            const versionedTx = SolanaVersionedTransaction.deserialize(txBuffer);
            // For versioned transactions, we need to sign differently
            versionedTx.sign([solanaKeypair]);
            const signature = await connection.sendRawTransaction(versionedTx.serialize(), {
              skipPreflight: false,
              preflightCommitment: 'confirmed',
            });
            await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
            console.log(`[SilentSwap] Versioned transaction confirmed: ${signature}`);
            return signature;
          } catch {
            // Fall back to legacy transaction
            transaction = SolanaTransaction.from(txBuffer);
            transaction.feePayer = solanaKeypair.publicKey;
            transaction.recentBlockhash = blockhash;
          }
        } else if (tx.instructions && tx.instructions.length > 0) {
          // Handle Relay instructions format
          console.log(`[SilentSwap] Building transaction from ${tx.instructions.length} instructions...`);
          transaction = new SolanaTransaction();
          transaction.feePayer = tx.feePayer ? new PublicKey(tx.feePayer) : solanaKeypair.publicKey;
          transaction.recentBlockhash = blockhash;

          // Add instructions from the quote
          for (const ix of tx.instructions) {
            // Data is hex-encoded (may or may not have 0x prefix)
            const dataStr = ix.data || '';
            const dataHex = dataStr.startsWith('0x') ? dataStr.slice(2) : dataStr;
            const dataBuffer = dataHex ? Buffer.from(dataHex, 'hex') : Buffer.alloc(0);

            const instruction = new TransactionInstruction({
              programId: new PublicKey(ix.programId),
              keys: ix.keys.map((k: any) => ({
                pubkey: new PublicKey(k.pubkey),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
              })),
              data: dataBuffer,
            });
            transaction.add(instruction);
          }
        } else {
          throw new Error('Invalid Solana transaction: no instructions or data');
        }

        // Sign and send
        transaction.sign(solanaKeypair);
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        // Confirm transaction
        await connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed');

        console.log(`[SilentSwap] Solana transaction confirmed: ${signature}`);
        return signature;
      };

      // Execute the bridge transaction with Solana executor
      const status = await executeBridgeTransaction(
        quote,
        null as any, // No EVM wallet client needed for Solana → EVM
        connector as any,
        (step: string) => {
          console.log(`[SilentSwap] Step: ${step}`);
        },
        solanaExecutor // Provide Solana executor for Solana transactions
      );

      console.log(`[SilentSwap] Bridge initiated: status=${status.status}`);

      return {
        success: status.status === 'pending' || status.status === 'success',
        swapId,
        requestId: status.requestId,
        status: status.status,
        txHashes: status.txHashes,
        depositAmount: amount,
        expectedOutput: toAmount,
      };
    }

    // Handle EVM source chains (EVM → Solana or EVM → EVM)
    // Note: This requires an EVM private key to sign transactions
    // For now, we return an error as this flow requires EVM wallet integration
    return {
      success: false,
      swapId,
      error: 'EVM → Solana bridges require signing on the source chain. Please use a wallet that supports EVM signing.',
    };

  } catch (error: any) {
    console.error('[SilentSwap] Swap execution error:', error.message);
    return {
      success: false,
      swapId,
      error: error.message || 'Swap execution failed',
    };
  }
}

/**
 * Get swap status
 */
export async function getSwapStatus(swapId: string): Promise<{
  status: string;
  txHashes?: string[];
  completedAt?: string;
}> {
  // Extract request ID from swap ID if available
  const requestIdMatch = swapId.match(/req_(.+)/);

  if (requestIdMatch) {
    try {
      // Query SilentSwap for status
      const status = await getSilentSwapBridgeStatus(swapId, 'mayan' as BridgeProvider);
      return {
        status: status.status,
        txHashes: status.txHashes,
        completedAt: status.status === 'success' ? new Date().toISOString() : undefined,
      };
    } catch {
      // Fallback
    }
  }

  // Default response for locally tracked swaps
  if (swapId.startsWith('ss_swap_')) {
    return {
      status: 'pending',
    };
  }

  return {
    status: 'unknown',
  };
}

/**
 * Estimate fees for a swap
 */
export async function estimateFees(
  amount: number,
  fromChain: ChainId,
  toChain: ChainId,
  fromToken: string = 'SOL',
  toToken: string = 'USDC'
): Promise<{
  networkFee: number;
  protocolFee: number;
  totalFee: number;
  feePercentage: number;
}> {
  try {
    const quote = await getSwapQuote(fromChain, toChain, fromToken, toToken, amount);

    return {
      networkFee: quote.fee * 0.8, // Estimate 80% is network fees
      protocolFee: quote.fee * 0.2, // Estimate 20% is protocol fees
      totalFee: quote.fee,
      feePercentage: quote.feePercentage,
    };
  } catch {
    // Fallback estimates
    const protocolFeePercentage = 0.5;
    const protocolFee = amount * (protocolFeePercentage / 100);

    const networkFees: Record<ChainId, number> = {
      solana: 0.001,
      ethereum: 0.005,
      base: 0.0001,
      polygon: 0.01,
      arbitrum: 0.0003,
      bsc: 0.001,
    };

    const fromNetworkFee = networkFees[fromChain] || 0.001;
    const toNetworkFee = networkFees[toChain] || 0.001;
    const totalNetworkFee = fromNetworkFee + toNetworkFee;

    return {
      networkFee: totalNetworkFee,
      protocolFee,
      totalFee: protocolFee + totalNetworkFee,
      feePercentage: protocolFeePercentage,
    };
  }
}

/**
 * Generate authentication message (kept for backward compatibility)
 */
export function generateAuthMessage(address: string, nonce: string): string {
  const domain = 'privacy-prediction-markets';
  const uri = 'https://api.silentswap.com';
  const issuedAt = new Date().toISOString();

  return `${domain} wants you to sign in with your wallet.

URI: ${uri}
Address: ${address}
Nonce: ${nonce}
Issued At: ${issuedAt}`;
}

/**
 * Get nonce for authentication (kept for backward compatibility)
 */
export async function getNonce(address: string): Promise<string> {
  return `nonce_${Date.now()}_${address.slice(0, 8)}`;
}

// Re-export config for backward compatibility
export const SILENTSWAP_CONFIG = {
  environment: config.silentswapEnvironment || 'mainnet',
  integratorId: config.silentswapIntegratorId || 'privacy-prediction-markets',
  baseUrl: 'https://api.silentswap.com',
};
