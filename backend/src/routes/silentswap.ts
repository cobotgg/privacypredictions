import { Router } from 'express';
import {
  isSilentSwapEnabled,
  getSupportedChainsAndTokens,
  getSwapQuote,
  executeSwap,
  getSwapStatus,
  estimateFees,
  ChainId,
  SUPPORTED_CHAINS,
} from '../services/silentswap.js';
import {
  executePrivateBridge,
  getPrivateBridgeQuote,
  getBridgeOperationStatus,
  getPendingBridgeOperations,
} from '../services/private-bridge.js';
import {
  getBridgeProviders,
  getBridgeQuote,
  executeBridge,
  getBridgeStatus,
  compareQuotes,
  type BridgeProvider,
} from '../services/bridge-providers.js';

const router = Router();

// Check bridge status and get all available providers
router.get('/status', (_req, res) => {
  const enabled = isSilentSwapEnabled();
  const { chains, tokens, config } = getSupportedChainsAndTokens();
  const providersInfo = getBridgeProviders();

  res.json({
    success: true,
    data: {
      enabled,
      provider: config.provider,
      chains,
      tokens,
      description: 'Multi-provider cross-chain bridge with privacy options',
      providers: providersInfo.providers,
      defaultProvider: providersInfo.default,
      endpoints: {
        multiProvider: {
          providers: 'GET /providers',
          quote: 'GET /multi/quote?provider=silentswap|shadowwire',
          swap: 'POST /multi/swap',
          compare: 'GET /multi/compare',
          status: 'GET /multi/status/:provider/:swapId',
          description: 'Multi-provider bridge with SilentSwap and ShadowWire',
        },
        standard: {
          quote: 'GET /quote',
          swap: 'POST /swap',
          description: 'Standard cross-chain swaps via SilentSwap (default)',
        },
        private: {
          quote: 'GET /private/quote',
          bridge: 'POST /private/bridge',
          status: 'GET /private/status/:operationId',
          description: 'Privacy-preserving cross-chain transfers via Privacy Pool + Bridge',
        },
      },
      features: [
        'SilentSwap: Privacy-preserving cross-chain bridge (no on-chain link)',
        'ShadowWire: ZK Bulletproof shielded transfers on Solana',
        'Private Bridge: Privacy Pool + any provider for untraceable transfers',
        'Range Compliance: Screening before all privacy transfers',
      ],
    },
  });
});

// Get quote for cross-chain swap
router.get('/quote', async (req, res) => {
  const { fromChain, toChain, fromToken, toToken, amount } = req.query;

  if (!fromChain || !toChain || !fromToken || !toToken || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: fromChain, toChain, fromToken, toToken, amount',
    });
  }

  // Validate chains
  if (!(fromChain as string in SUPPORTED_CHAINS) || !(toChain as string in SUPPORTED_CHAINS)) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported chain',
    });
  }

  if (!isSilentSwapEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'SilentSwap is not configured. Please provide SILENTSWAP_API_KEY.',
    });
  }

  try {
    const quote = await getSwapQuote(
      fromChain as ChainId,
      toChain as ChainId,
      fromToken as string,
      toToken as string,
      parseFloat(amount as string)
    );

    res.json({
      success: true,
      data: quote,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get quote',
    });
  }
});

// Execute cross-chain swap
router.post('/swap', async (req, res) => {
  const {
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    fromAddress,
    toAddress,
    evmPrivateKey,
    solanaWalletId,
  } = req.body;

  if (!fromChain || !toChain || !fromToken || !toToken || !amount || !fromAddress || !toAddress) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: fromChain, toChain, fromToken, toToken, amount, fromAddress, toAddress',
    });
  }

  // Note: For Solana → EVM bridges, we sign with the Solana wallet
  // EVM private key is NOT needed when Solana is the source chain
  // The destination EVM address just receives funds (no signing needed)

  if (!isSilentSwapEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'Bridge is not configured.',
    });
  }

  try {
    console.log(`[Bridge] Starting swap: ${amount} ${fromToken} (${fromChain}) -> ${toToken} (${toChain})`);

    const result = await executeSwap({
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      fromAddress,
      toAddress,
      evmPrivateKey,
      solanaWalletId,
    });

    if (result.success) {
      res.json({
        success: true,
        data: {
          ...result,
          provider: 'silentswap',
          message: 'Cross-chain swap executed successfully via SilentSwap',
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[Bridge] Swap error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute swap',
    });
  }
});

// Get swap status
router.get('/swap/:swapId/status', async (req, res) => {
  const { swapId } = req.params;

  if (!isSilentSwapEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'SilentSwap is not configured',
    });
  }

  try {
    const status = await getSwapStatus(swapId);
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get swap status',
    });
  }
});

// Estimate fees
router.get('/fees/estimate', async (req, res) => {
  const { amount, fromChain, toChain, fromToken, toToken } = req.query;

  if (!amount || !fromChain || !toChain) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: amount, fromChain, toChain',
    });
  }

  // Validate chains
  if (!(fromChain as string in SUPPORTED_CHAINS) || !(toChain as string in SUPPORTED_CHAINS)) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported chain',
    });
  }

  try {
    const fees = await estimateFees(
      parseFloat(amount as string),
      fromChain as ChainId,
      toChain as ChainId,
      (fromToken as string) || 'SOL',
      (toToken as string) || 'USDC'
    );

    res.json({
      success: true,
      data: fees,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to estimate fees',
    });
  }
});

// ============================================
// MULTI-PROVIDER BRIDGE ENDPOINTS
// Supports LI.FI, SilentSwap, and ShadowWire
// ============================================

/**
 * Get all available bridge providers
 */
router.get('/providers', (_req, res) => {
  const providersInfo = getBridgeProviders();
  res.json({
    success: true,
    data: providersInfo,
  });
});

/**
 * Get quote from a specific provider
 */
router.get('/multi/quote', async (req, res) => {
  const { provider, fromChain, toChain, fromToken, toToken, amount } = req.query;

  if (!provider || !fromChain || !toChain || !fromToken || !toToken || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: provider, fromChain, toChain, fromToken, toToken, amount',
    });
  }

  const validProviders: BridgeProvider[] = ['silentswap', 'shadowwire'];
  if (!validProviders.includes(provider as BridgeProvider)) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    });
  }

  try {
    const quote = await getBridgeQuote({
      provider: provider as BridgeProvider,
      fromChain: fromChain as string,
      toChain: toChain as string,
      fromToken: fromToken as string,
      toToken: toToken as string,
      amount: parseFloat(amount as string),
    });

    res.json({
      success: true,
      data: quote,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get quote',
    });
  }
});

/**
 * Execute swap via specific provider
 */
router.post('/multi/swap', async (req, res) => {
  const {
    provider,
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    fromAddress,
    toAddress,
    evmPrivateKey,
    solanaWalletId,
    siweSignature,
  } = req.body;

  if (!provider || !fromChain || !toChain || !fromToken || !toToken || !amount || !fromAddress || !toAddress) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: provider, fromChain, toChain, fromToken, toToken, amount, fromAddress, toAddress',
    });
  }

  const validProviders: BridgeProvider[] = ['silentswap', 'shadowwire'];
  if (!validProviders.includes(provider as BridgeProvider)) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    });
  }

  // Validate provider-specific requirements
  if (provider === 'shadowwire' && (fromChain !== 'solana' || toChain !== 'solana')) {
    return res.status(400).json({
      success: false,
      error: 'ShadowWire only supports transfers within Solana',
    });
  }

  if (provider === 'silentswap' &&
      (fromChain !== 'solana' && toChain !== 'solana') && !evmPrivateKey) {
    return res.status(400).json({
      success: false,
      error: 'evmPrivateKey is required for EVM-to-EVM swaps',
    });
  }

  try {
    console.log(`[Multi Bridge] ${provider}: ${amount} ${fromToken} (${fromChain}) -> ${toToken} (${toChain})`);

    const result = await executeBridge({
      provider: provider as BridgeProvider,
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      fromAddress,
      toAddress,
      evmPrivateKey,
      solanaWalletId,
      siweSignature,
    });

    if (result.success) {
      res.json({
        success: true,
        data: result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error(`[Multi Bridge] ${provider} error:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute swap',
    });
  }
});

/**
 * Compare quotes from all available providers
 */
router.get('/multi/compare', async (req, res) => {
  const { fromChain, toChain, fromToken, toToken, amount } = req.query;

  if (!fromChain || !toChain || !fromToken || !toToken || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: fromChain, toChain, fromToken, toToken, amount',
    });
  }

  try {
    const quotes = await compareQuotes(
      fromChain as string,
      toChain as string,
      fromToken as string,
      toToken as string,
      parseFloat(amount as string)
    );

    res.json({
      success: true,
      data: {
        count: quotes.length,
        quotes,
        recommendation: quotes[0] ? {
          bestRate: quotes[0].provider,
          bestPrivacy: quotes.find(q => q.privacyLevel === 'high')?.provider || null,
        } : null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to compare quotes',
    });
  }
});

/**
 * Get swap status from specific provider
 */
router.get('/multi/status/:provider/:swapId', async (req, res) => {
  const { provider, swapId } = req.params;

  const validProviders: BridgeProvider[] = ['silentswap', 'shadowwire'];
  if (!validProviders.includes(provider as BridgeProvider)) {
    return res.status(400).json({
      success: false,
      error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
    });
  }

  try {
    const status = await getBridgeStatus(provider as BridgeProvider, swapId);
    res.json({
      success: true,
      data: {
        provider,
        swapId,
        ...status,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get status',
    });
  }
});

// ============================================
// PRIVATE BRIDGE ENDPOINTS
// These combine privacy pools with cross-chain bridging
// for untraceable transfers between Solana and EVM chains
// ============================================

/**
 * Get quote for private bridge
 * Includes privacy pool fee + bridge fee
 */
router.get('/private/quote', async (req, res) => {
  const { direction, fromChain, toChain, fromToken, toToken, amount } = req.query;

  if (!direction || !fromChain || !toChain || !fromToken || !toToken || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: direction, fromChain, toChain, fromToken, toToken, amount',
    });
  }

  if (!['out', 'in'].includes(direction as string)) {
    return res.status(400).json({
      success: false,
      error: 'direction must be "out" (Solana→EVM) or "in" (EVM→Solana)',
    });
  }

  try {
    const quote = await getPrivateBridgeQuote(
      direction as 'out' | 'in',
      fromChain as ChainId,
      toChain as ChainId,
      fromToken as string,
      toToken as string,
      parseFloat(amount as string)
    );

    res.json({
      success: true,
      data: {
        ...quote,
        direction,
        privacyProtected: true,
        description: direction === 'out'
          ? 'Trading Wallet → Privacy Pool → Intermediate → Bridge → EVM'
          : 'EVM → Bridge → Intermediate → Privacy Pool → Trading Wallet',
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get private bridge quote',
    });
  }
});

/**
 * Execute private bridge transfer
 *
 * For direction='out' (Solana → EVM):
 * - Requires: tradingWalletId, evmAddress
 * - Flow: Trading Wallet → Privacy Pool → Bridge → EVM
 *
 * For direction='in' (EVM → Solana):
 * - Requires: evmAddress, evmPrivateKey
 * - Optional: destinationWalletId (creates new if not provided)
 * - Flow: EVM → Bridge → Privacy Pool → Trading Wallet
 */
router.post('/private/bridge', async (req, res) => {
  const {
    direction,
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    tradingWalletId,
    destinationWalletId,
    evmAddress,
    evmPrivateKey,
    privacyProvider = 'privacycash',
    skipCompliance = false,
  } = req.body;

  // Validate required fields
  if (!direction || !fromToken || !toToken || !amount || !evmAddress) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: direction, fromToken, toToken, amount, evmAddress',
    });
  }

  if (!['out', 'in'].includes(direction)) {
    return res.status(400).json({
      success: false,
      error: 'direction must be "out" (Solana→EVM) or "in" (EVM→Solana)',
    });
  }

  // Validate direction-specific requirements
  if (direction === 'out' && !tradingWalletId) {
    return res.status(400).json({
      success: false,
      error: 'tradingWalletId is required for outbound bridge (Solana→EVM)',
    });
  }

  if (direction === 'in' && !evmPrivateKey) {
    return res.status(400).json({
      success: false,
      error: 'evmPrivateKey is required for inbound bridge (EVM→Solana)',
    });
  }

  try {
    console.log(`[Private Bridge] Starting ${direction} transfer: ${amount} ${fromToken} → ${toToken}`);

    const result = await executePrivateBridge({
      direction,
      fromChain: direction === 'out' ? 'solana' : (fromChain || 'ethereum'),
      toChain: direction === 'out' ? (toChain || 'ethereum') : 'solana',
      fromToken,
      toToken,
      amount,
      tradingWalletId,
      destinationWalletId,
      evmAddress,
      evmPrivateKey,
      privacyProvider,
      skipCompliance,
    });

    if (result.success) {
      res.json({
        success: true,
        data: {
          ...result,
          privacyProtected: true,
          message: direction === 'out'
            ? 'Private bridge OUT complete! No on-chain link between trading wallet and EVM destination.'
            : 'Private bridge IN complete! No on-chain link between EVM source and trading wallet.',
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        operationId: result.operationId,
        status: result.status,
      });
    }
  } catch (error) {
    console.error('[Private Bridge] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute private bridge',
    });
  }
});

/**
 * Get private bridge operation status
 */
router.get('/private/status/:operationId', (req, res) => {
  const { operationId } = req.params;

  const operation = getBridgeOperationStatus(operationId);

  if (!operation) {
    return res.status(404).json({
      success: false,
      error: 'Operation not found',
    });
  }

  res.json({
    success: true,
    data: operation,
  });
});

/**
 * List pending private bridge operations
 */
router.get('/private/pending', (_req, res) => {
  const operations = getPendingBridgeOperations();

  res.json({
    success: true,
    data: {
      count: operations.length,
      operations,
    },
  });
});

export default router;
