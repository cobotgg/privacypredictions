import axios, { AxiosInstance, AxiosError } from 'axios';
import { Connection, Keypair, Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { config } from '../config/env.js';
import { getConnection } from './wallet.js';
import type { Market, MarketQuote, Order, OrderResult, Position } from '../types/index.js';

// Helper to retry API calls with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  operationName: string = 'API call'
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRetryable =
        error.message?.includes('fetch failed') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT') ||
        error.message?.includes('network') ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        (error.response?.status >= 500 && error.response?.status < 600);

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`[DFlow] ${operationName} failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// Create API clients with longer timeouts
const metadataApi: AxiosInstance = axios.create({
  baseURL: config.dflowMetadataApiUrl,
  headers: {
    'x-api-key': config.dflowApiKey,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 seconds for metadata API
});

const tradeApi: AxiosInstance = axios.create({
  baseURL: config.dflowTradeApiUrl,
  headers: {
    'x-api-key': config.dflowApiKey,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 seconds for trade API
});

// Fetch active markets
export async function fetchMarkets(limit: number = 50): Promise<Market[]> {
  try {
    const response = await metadataApi.get('/markets', {
      params: { status: 'active', limit },
    });

    const markets = response.data?.markets || response.data?.data || response.data || [];

    if (!Array.isArray(markets)) {
      console.error('Unexpected markets response format:', typeof markets);
      return [];
    }

    return markets.map((m: any) => {
      // Parse prices - API returns as decimal strings like "0.67" meaning 67 cents
      const yesAsk = parseFloat(m.yesAsk || m.yesBid || '0.5') * 100;
      const noAsk = parseFloat(m.noAsk || m.noBid || '0.5') * 100;

      return {
        id: m.ticker || m.marketId,
        ticker: m.ticker,
        title: m.title || m.question,
        description: m.description || m.rulesPrimary,
        status: m.status,
        yesPrice: Math.round(yesAsk),
        noPrice: Math.round(noAsk),
        volume24h: (m.volume || 0) / 1_000_000, // Convert from micro to dollars
        liquidity: m.openInterest ? m.openInterest / 1_000_000 : 0,
        expiryTime: m.expirationTime ? new Date(m.expirationTime * 1000).toISOString() : m.closeTime,
        yesMint: m.accounts?.[config.usdcMint]?.yesMint,
        noMint: m.accounts?.[config.usdcMint]?.noMint,
      };
    });
  } catch (error: any) {
    console.error('Error fetching markets:', error.message);
    throw new Error(`Failed to fetch markets: ${error.message}`);
  }
}

// Get trending markets (sorted by volume)
export async function getTrendingMarkets(limit: number = 5): Promise<Market[]> {
  const markets = await fetchMarkets(100);
  return markets
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, limit);
}

// Cache for markets to avoid repeated API calls
let marketsCache: { markets: Market[]; timestamp: number } | null = null;
const CACHE_TTL = 60000; // 1 minute

// Get single market by ticker from DFlow API (includes expired/settled markets)
export async function getMarketByTicker(ticker: string): Promise<Market | null> {
  try {
    console.log(`[DFlow] Fetching market by ticker: ${ticker}`);
    const response = await metadataApi.get(`/market/${ticker}`);
    const m = response.data;

    if (!m) {
      console.log(`[DFlow] Market not found: ${ticker}`);
      return null;
    }

    // Parse prices
    const yesAsk = parseFloat(m.yesAsk || m.yesBid || '0.5') * 100;
    const noAsk = parseFloat(m.noAsk || m.noBid || '0.5') * 100;

    return {
      id: m.ticker || m.marketId,
      ticker: m.ticker,
      title: m.title || m.question,
      description: m.description || m.rulesPrimary,
      status: m.status,
      yesPrice: Math.round(yesAsk),
      noPrice: Math.round(noAsk),
      volume24h: (m.volume || 0) / 1_000_000,
      liquidity: m.openInterest ? m.openInterest / 1_000_000 : 0,
      expiryTime: m.expirationTime ? new Date(m.expirationTime * 1000).toISOString() : m.closeTime,
      yesMint: m.accounts?.[config.usdcMint]?.yesMint,
      noMint: m.accounts?.[config.usdcMint]?.noMint,
    };
  } catch (error: any) {
    // 404 means market not found, other errors are real errors
    if (error.response?.status === 404) {
      console.log(`[DFlow] Market ${ticker} not found (404)`);
      return null;
    }
    console.error(`[DFlow] Error fetching market ${ticker}:`, error.message);
    return null;
  }
}

// Get single market (from cache or fetch active markets)
export async function getMarket(marketId: string): Promise<Market | null> {
  try {
    console.log(`[DFlow] getMarket called with marketId: "${marketId}"`);

    // Check cache first
    if (marketsCache && Date.now() - marketsCache.timestamp < CACHE_TTL) {
      const cached = marketsCache.markets.find(m => m.id === marketId || m.ticker === marketId);
      if (cached) {
        console.log(`[DFlow] Found in cache: ${cached.id} (${cached.ticker}) - "${cached.title}"`);
        return cached;
      }
      console.log(`[DFlow] Not in cache, fetching directly...`);
    }

    // First try to get market directly by ticker (includes expired markets)
    const directMarket = await getMarketByTicker(marketId);
    if (directMarket) {
      console.log(`[DFlow] Found directly: ${directMarket.id} (${directMarket.ticker}) - "${directMarket.title}"`);
      console.log(`[DFlow] YES mint: ${directMarket.yesMint}`);
      console.log(`[DFlow] NO mint: ${directMarket.noMint}`);
      return directMarket;
    }

    // Fallback: Fetch all active markets and find the one we need
    console.log(`[DFlow] Direct fetch failed, fetching all markets...`);
    const markets = await fetchMarkets(200);
    marketsCache = { markets, timestamp: Date.now() };

    const market = markets.find(m => m.id === marketId || m.ticker === marketId);
    if (!market) {
      console.error(`[DFlow] Market not found in any source: ${marketId}`);
      return null;
    }

    console.log(`[DFlow] Found in fetchMarkets: ${market.id} (${market.ticker}) - "${market.title}"`);
    return market;
  } catch (error: any) {
    console.error(`[DFlow] Error fetching market ${marketId}:`, error.message);
    return null;
  }
}

// Get quote for a trade
export async function getQuote(
  marketId: string,
  side: 'yes' | 'no',
  amountUsd: number,
  walletAddress: string
): Promise<MarketQuote> {
  try {
    const market = await getMarket(marketId);
    if (!market) {
      throw new Error(`Market not found: ${marketId}`);
    }

    // Get mints from market
    const outcomeMint = side === 'yes' ? market.yesMint : market.noMint;
    if (!outcomeMint) {
      throw new Error(`Outcome mint not found for ${side}`);
    }

    // Request quote from DFlow with retry logic
    const amountMicro = Math.round(amountUsd * 1_000_000);

    const response = await withRetry(
      () => tradeApi.get('/order', {
        params: {
          inputMint: config.usdcMint,
          outputMint: outcomeMint,
          amount: amountMicro.toString(),
          swapMode: 'ExactIn',
          slippageBps: '50',
          userPublicKey: walletAddress,
        },
      }),
      3,
      1000,
      `Get quote for ${marketId}`
    );

    const quote = response.data;
    const outAmount = parseInt(quote.outAmount || '0');
    const shares = outAmount / 1_000_000;
    const price = amountUsd / shares;

    return {
      marketId,
      side,
      amount: amountUsd,
      shares,
      price,
      fee: amountUsd * 0.005, // Estimate 0.5% fee
      slippage: 50,
    };
  } catch (error: any) {
    console.error('Error getting quote:', error.message);
    throw new Error(`Failed to get quote: ${error.message}`);
  }
}

// Place an order
export async function placeOrder(
  order: Order,
  keypair: Keypair
): Promise<OrderResult> {
  const connection = getConnection();

  try {
    console.log(`[DFlow] ========== PLACING ORDER ==========`);
    console.log(`[DFlow] Requested marketId: ${order.marketId}`);
    console.log(`[DFlow] Requested side: ${order.side}`);
    console.log(`[DFlow] Requested amount: ${order.amount}`);

    const market = await getMarket(order.marketId);
    if (!market) {
      return { success: false, error: `Market not found: ${order.marketId}` };
    }

    // CRITICAL: Validate that the returned market matches the requested marketId
    if (market.id !== order.marketId && market.ticker !== order.marketId) {
      console.error(`[DFlow] MARKET ID MISMATCH! Requested: ${order.marketId}, Got: ${market.id} (${market.ticker})`);
      return { success: false, error: `Market ID mismatch: requested ${order.marketId} but got ${market.id}` };
    }

    console.log(`[DFlow] Found market:`);
    console.log(`[DFlow]   - ID: ${market.id}`);
    console.log(`[DFlow]   - Ticker: ${market.ticker}`);
    console.log(`[DFlow]   - Title: ${market.title}`);
    console.log(`[DFlow]   - Status: ${market.status}`);
    console.log(`[DFlow]   - YES Mint: ${market.yesMint}`);
    console.log(`[DFlow]   - NO Mint: ${market.noMint}`);

    if (market.status !== 'active') {
      return { success: false, error: `Market is not active: ${market.status}` };
    }

    const outcomeMint = order.side === 'yes' ? market.yesMint : market.noMint;
    if (!outcomeMint) {
      return { success: false, error: `Outcome mint not found for ${order.side}` };
    }

    console.log(`[DFlow] Using outcome mint: ${outcomeMint} for side: ${order.side}`);

    // Request order transaction from DFlow with retry logic for both network and API errors
    const amountMicro = Math.round(order.amount * 1_000_000);
    const maxRetries = 3;
    let orderData: any = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await tradeApi.get('/order', {
          params: {
            inputMint: config.usdcMint,
            outputMint: outcomeMint,
            amount: amountMicro.toString(),
            swapMode: 'ExactIn',
            slippageBps: '50',
            userPublicKey: keypair.publicKey.toBase58(),
          },
        });

        orderData = response.data;
        console.log(`[DFlow] Order response (attempt ${attempt}):`, JSON.stringify(orderData, null, 2));

        // Check for error in response (DFlow returns 200 but with error message)
        const errorMsg = orderData.error || orderData.message;
        if (errorMsg && typeof errorMsg === 'string') {
          const isRetryable = errorMsg.includes('fetch failed') ||
            errorMsg.includes('ECONNRESET') ||
            errorMsg.includes('ETIMEDOUT') ||
            errorMsg.includes('balance');

          if (isRetryable && attempt < maxRetries) {
            const delayMs = 1000 * Math.pow(2, attempt - 1);
            console.log(`[DFlow] Order API returned error (attempt ${attempt}/${maxRetries}): ${errorMsg}. Retrying in ${delayMs}ms...`);
            lastError = errorMsg;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          lastError = errorMsg;
        }

        // Success - we have transaction data (DFlow returns 'transaction' not 'swapTransaction')
        if (orderData.swapTransaction || orderData.transaction) {
          break;
        }

        // No transaction but no explicit error - treat as retryable
        if (attempt < maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          console.log(`[DFlow] No transaction in response (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`);
          lastError = 'No transaction returned from DFlow';
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      } catch (networkError: any) {
        // Log full error response if available
        if (networkError.response) {
          console.error(`[DFlow] API error response (${networkError.response.status}):`, JSON.stringify(networkError.response.data, null, 2));
          lastError = networkError.response.data?.message || networkError.response.data?.error || networkError.message;
        } else {
          lastError = networkError.message;
        }

        const isRetryable =
          networkError.message?.includes('fetch failed') ||
          networkError.message?.includes('ECONNRESET') ||
          networkError.code === 'ECONNRESET';

        if (isRetryable && attempt < maxRetries) {
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          console.log(`[DFlow] Network error (attempt ${attempt}/${maxRetries}): ${networkError.message}. Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        throw networkError;
      }
    }

    const txData = orderData?.swapTransaction || orderData?.transaction;
    if (!txData) {
      return { success: false, error: lastError || 'No transaction returned from DFlow' };
    }

    // Decode and sign transaction
    const txBuffer = Buffer.from(txData, 'base64');
    let transaction: Transaction | VersionedTransaction;

    try {
      transaction = VersionedTransaction.deserialize(txBuffer);
      (transaction as VersionedTransaction).sign([keypair]);
    } catch {
      transaction = Transaction.from(txBuffer);
      transaction.sign(keypair);
    }

    // Send transaction
    const rawTx = transaction.serialize();
    const signature = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    const outAmount = parseInt(orderData.outAmount || '0');
    const shares = outAmount / 1_000_000;

    return {
      success: true,
      signature,
      shares,
      positionMint: outcomeMint, // Include position token mint for closing later
    };
  } catch (error: any) {
    console.error('Error placing order:', error.message);
    return { success: false, error: error.message };
  }
}

// Get positions for a wallet by fetching token accounts from blockchain
export async function getPositions(walletAddress: string): Promise<Position[]> {
  const connection = getConnection();

  try {
    console.log(`[DFlow] Fetching positions for: ${walletAddress}`);

    // Step 1: Fetch all token accounts using TOKEN_2022_PROGRAM_ID (DFlow uses Token-2022)
    const userWallet = new PublicKey(walletAddress);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      userWallet,
      { programId: TOKEN_2022_PROGRAM_ID }
    );

    // Map into simpler structure
    const userTokens = tokenAccounts.value.map(({ account }) => {
      const info = account.data.parsed.info;
      return {
        mint: info.mint,
        rawBalance: info.tokenAmount.amount,
        balance: info.tokenAmount.uiAmount,
        decimals: info.tokenAmount.decimals,
      };
    });

    // Filter non-zero balances
    const nonZeroBalances = userTokens.filter((t) => t.balance > 0);
    console.log(`[DFlow] Found ${nonZeroBalances.length} non-zero token accounts`);

    if (nonZeroBalances.length === 0) {
      return [];
    }

    // Step 2: Filter for outcome tokens using DFlow API
    const allMintAddresses = nonZeroBalances.map((token) => token.mint);

    const filterResponse = await metadataApi.post('/filter_outcome_mints', {
      addresses: allMintAddresses,
    });

    const outcomeMints: string[] = filterResponse.data.outcomeMints || [];
    console.log(`[DFlow] Found ${outcomeMints.length} outcome mints`);

    if (outcomeMints.length === 0) {
      return [];
    }

    // Step 3: Get market details for outcome tokens
    const marketsResponse = await metadataApi.post('/markets/batch', {
      mints: outcomeMints,
    });

    const markets = marketsResponse.data.markets || [];
    console.log(`[DFlow] Fetched ${markets.length} market details`);

    // Create map by mint address
    const marketsByMint = new Map<string, any>();
    markets.forEach((market: any) => {
      Object.values(market.accounts || {}).forEach((account: any) => {
        if (account.yesMint) marketsByMint.set(account.yesMint, { ...market, isYes: true });
        if (account.noMint) marketsByMint.set(account.noMint, { ...market, isYes: false });
      });
    });

    // Step 4: Build positions
    const positions: Position[] = [];
    const outcomeTokens = nonZeroBalances.filter((token) => outcomeMints.includes(token.mint));

    for (const token of outcomeTokens) {
      const marketInfo = marketsByMint.get(token.mint);
      if (!marketInfo) continue;

      const isYesToken = marketInfo.isYes;
      const market = marketInfo;

      // Get current price from market data (API returns 0-1 decimal, convert to cents 0-100)
      const yesPriceDecimal = parseFloat(market.yesAsk || market.yesBid || '0.5');
      const noPriceDecimal = parseFloat(market.noAsk || market.noBid || '0.5');

      // Convert to cents (0-100 scale)
      const yesPrice = Math.round(yesPriceDecimal * 100);
      const noPrice = Math.round(noPriceDecimal * 100);
      const currentPrice = isYesToken ? yesPrice : noPrice;

      // Entry price: Use 50¢ as default since we don't have trade history stored
      // TODO: Track entry prices in database when trades are placed
      const entryPrice = 50; // 50 cents = 50%
      const shares = token.balance;

      // P&L in dollars: shares * (currentPrice - entryPrice) / 100
      const pnl = shares * (currentPrice - entryPrice) / 100;
      const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

      positions.push({
        id: token.mint,
        marketId: market.ticker,
        marketTitle: market.title || market.question || market.ticker,
        side: isYesToken ? 'yes' : 'no',
        shares,
        entryPrice,
        currentPrice,
        pnl,
        pnlPercent,
        walletAddress,
        mint: token.mint,
      });
    }

    console.log(`[DFlow] Returning ${positions.length} positions`);
    return positions;
  } catch (error: any) {
    console.error('Error fetching positions:', error.message);
    return [];
  }
}

// Close a position (sell outcome tokens back to USDC)
// positionMint is the token mint (outcome token) that we're selling
// Market MUST be active - use redeemPosition for settled markets
export async function closePosition(
  positionMint: string,
  marketId: string,
  side: 'yes' | 'no',
  shares: number,
  keypair: Keypair
): Promise<OrderResult> {
  const connection = getConnection();

  try {
    console.log(`[DFlow] Closing position: mint=${positionMint}, market=${marketId}, side=${side}, shares=${shares}`);

    // STEP 1: Check market status first
    // Only active/initialized markets can be sold - expired/settled need redemption
    let market: Market | null = null;
    try {
      market = await getMarket(marketId);
    } catch (e) {
      console.log(`[DFlow] Could not fetch market ${marketId}, will try to sell anyway`);
    }

    if (market) {
      const marketStatus = market.status?.toLowerCase();
      console.log(`[DFlow] Market status: ${marketStatus}`);

      // Check if market is tradeable
      const isActiveTradeable = marketStatus === 'active' || marketStatus === 'open' || marketStatus === 'initialized';

      if (!isActiveTradeable) {
        // Market is not active - provide helpful error
        if (marketStatus === 'determined' || marketStatus === 'finalized' || marketStatus === 'settled') {
          return {
            success: false,
            error: `Market "${marketId}" is ${marketStatus}. Positions on settled markets must be redeemed, not sold. ` +
              `Check if you won (your side: ${side}) and use the DFlow dashboard or wait for automatic redemption.`,
          };
        } else {
          return {
            success: false,
            error: `Market "${marketId}" is not active (status: ${marketStatus}). Cannot sell positions on inactive markets.`,
          };
        }
      }
    }

    // STEP 2: Get outcome mint from market if available, or use positionMint directly
    let outcomeMint = positionMint;
    if (market) {
      const marketMint = side === 'yes' ? market.yesMint : market.noMint;
      if (marketMint && marketMint !== positionMint) {
        console.log(`[DFlow] Using market mint ${marketMint} instead of provided ${positionMint}`);
        outcomeMint = marketMint;
      }
    }

    // STEP 3: Request sell order from DFlow
    const amountMicro = Math.round(shares * 1_000_000);
    console.log(`[DFlow] Requesting sell order: inputMint=${outcomeMint}, outputMint=${config.usdcMint}, amount=${amountMicro}`);

    try {
      const response = await withRetry(
        () => tradeApi.get('/order', {
          params: {
            inputMint: outcomeMint,
            outputMint: config.usdcMint,
            amount: amountMicro.toString(),
            swapMode: 'ExactIn',
            slippageBps: '100',
            userPublicKey: keypair.publicKey.toBase58(),
          },
        }),
        3,
        1000,
        `Close position for ${marketId}`
      );

      const orderData = response.data;
      console.log(`[DFlow] Close order response:`, JSON.stringify(orderData, null, 2));

      // Check for route_not_found error
      if (orderData.code === 'route_not_found' || orderData.msg === 'Route not found') {
        // This typically means no bid-side liquidity (market maker not buying this token)
        return {
          success: false,
          error: `Cannot sell ${side.toUpperCase()} tokens: No liquidity available. ` +
            `The market maker is not currently buying ${side.toUpperCase()} tokens for "${marketId}". ` +
            `Wait for liquidity or market settlement.`,
        };
      }

      const txData = orderData.swapTransaction || orderData.transaction;

      if (!txData) {
        const errorMsg = orderData.error || orderData.message || orderData.msg || 'No transaction returned';
        return { success: false, error: errorMsg };
      }

      // STEP 4: Decode and sign transaction
      const txBuffer = Buffer.from(txData, 'base64');
      let transaction: Transaction | VersionedTransaction;

      try {
        transaction = VersionedTransaction.deserialize(txBuffer);
        (transaction as VersionedTransaction).sign([keypair]);
      } catch {
        transaction = Transaction.from(txBuffer);
        transaction.sign(keypair);
      }

      // STEP 5: Send transaction
      const rawTx = transaction.serialize();
      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`[DFlow] Close transaction sent: ${signature}`);
      await connection.confirmTransaction(signature, 'confirmed');
      console.log(`[DFlow] Close transaction confirmed: ${signature}`);

      return { success: true, signature };
    } catch (apiError: any) {
      // Handle axios error response
      const errorResponse = apiError.response?.data;
      console.log(`[DFlow] API error response:`, JSON.stringify(errorResponse, null, 2));

      if (errorResponse?.code === 'route_not_found' || errorResponse?.msg === 'Route not found') {
        return {
          success: false,
          error: `Cannot sell ${side.toUpperCase()} tokens: No liquidity available. ` +
            `The market maker is not currently buying ${side.toUpperCase()} tokens for "${marketId}". ` +
            `Wait for liquidity or market settlement.`,
        };
      }

      throw apiError;
    }
  } catch (error: any) {
    console.error('Error closing position:', error.message);
    return { success: false, error: error.message };
  }
}
