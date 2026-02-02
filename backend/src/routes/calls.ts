/**
 * Encrypted Calls API Routes - Production Grade (On-Chain)
 *
 * Allows users to make encrypted predictions ("calls") on markets.
 * Predictions are stored ON-CHAIN via Light Protocol ZK compression.
 */

import { Router } from 'express';
import {
  createCall,
  getCallsForMarket,
  getCallsByUser,
  getCall,
  revealCallWithPayment,
  resolveMarket,
  isMarketResolved,
  getMarketResolution,
  getCallsStats,
  listCalls,
  getPaymentRecipient,
} from '../services/encrypted-calls.js';

const router = Router();

/**
 * GET /api/calls/status
 *
 * Get calls service status and statistics
 */
router.get('/status', async (_req, res) => {
  try {
    const stats = getCallsStats();
    let paymentAddress: string | undefined;

    try {
      paymentAddress = getPaymentRecipient();
    } catch {
      paymentAddress = undefined;
    }

    res.json({
      success: true,
      data: {
        enabled: true,
        onChain: true,
        network: 'mainnet',
        encryption: 'Inco Network TEE + AES-256-GCM fallback',
        storage: 'Light Protocol ZK Compression',
        paymentAddress,
        ...stats,
        features: [
          'ON-CHAIN prediction hash storage via Light Protocol',
          'Encrypted predictions using Inco TEE',
          'Immutable timestamp proof (cannot backdate)',
          'Verifiable via Solana Explorer',
          'Auto-reveal on market resolution',
          'Pay-to-reveal for early access (~$0.20)',
          'REQUIRES real SOL payment verification on-chain',
        ],
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/calls/create
 *
 * Create a new encrypted call (prediction) for a market
 * Stores prediction hash ON-CHAIN for immutable timestamp proof
 *
 * Body:
 * - marketId: string - The market to make a call on
 * - prediction: string - The user's prediction text (will be encrypted)
 * - userWallet: string - The user's wallet address
 * - revealCondition?: 'market_resolution' | 'payment' | 'both' (default: 'both')
 * - revealPrice?: number - Price in lamports to reveal early (default: ~$0.10)
 */
router.post('/create', async (req, res) => {
  try {
    const { marketId, prediction, userWallet, revealCondition, revealPrice } = req.body;

    if (!marketId || !prediction || !userWallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: marketId, prediction, userWallet',
      });
    }

    if (prediction.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Prediction too long (max 500 characters)',
      });
    }

    const result = await createCall({
      marketId,
      prediction,
      userWallet,
      revealCondition,
      revealPrice,
    });

    if (result.success && result.call) {
      res.json({
        success: true,
        data: {
          callId: result.call.id,
          marketId: result.call.marketId,
          status: result.call.status,
          predictionHash: result.call.predictionHash,
          revealCondition: result.call.revealCondition,
          revealPrice: result.call.revealPrice,
          revealPriceSOL: `${result.call.revealPrice / 1e9} SOL`,
          timestamp: result.call.timestamp,
          onChain: {
            txSignature: result.call.onChain.txSignature,
            explorerUrl: result.call.onChain.explorerUrl,
            network: result.call.onChain.network,
            verified: true,
          },
          message: 'Your prediction has been encrypted and recorded ON-CHAIN!',
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/calls/market/:marketId
 *
 * Get all calls for a specific market
 */
router.get('/market/:marketId', async (req, res) => {
  try {
    const { marketId } = req.params;
    const calls = getCallsForMarket(marketId);
    const resolution = getMarketResolution(marketId);

    res.json({
      success: true,
      data: {
        marketId,
        resolved: resolution?.resolved || false,
        outcome: resolution?.outcome,
        resolvedAt: resolution?.resolvedAt,
        calls: calls.map(c => ({
          id: c.id,
          userWallet: c.userWallet.substring(0, 8) + '...',
          status: c.status,
          predictionHash: c.predictionHash.substring(0, 16) + '...',
          timestamp: c.timestamp,
          revealCondition: c.revealCondition,
          revealPrice: c.revealPrice,
          revealPriceSOL: `${c.revealPrice / 1e9} SOL`,
          revealedPrediction: c.status === 'revealed' ? c.revealedPrediction : '🔒 Encrypted',
          revealedAt: c.revealedAt,
          onChain: {
            txSignature: c.onChain?.txSignature,
            explorerUrl: c.onChain?.explorerUrl,
          },
        })),
        totalCalls: calls.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/calls/user/:wallet
 *
 * Get all calls made by a specific user
 */
router.get('/user/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const calls = getCallsByUser(wallet);

    res.json({
      success: true,
      data: {
        userWallet: wallet,
        calls: calls.map(c => ({
          id: c.id,
          marketId: c.marketId,
          status: c.status,
          predictionHash: c.predictionHash.substring(0, 16) + '...',
          timestamp: c.timestamp,
          revealCondition: c.revealCondition,
          revealPrice: c.revealPrice,
          revealPriceSOL: `${c.revealPrice / 1e9} SOL`,
          revealedPrediction: c.revealedPrediction,
          revealedAt: c.revealedAt,
          onChain: {
            txSignature: c.onChain?.txSignature,
            explorerUrl: c.onChain?.explorerUrl,
          },
        })),
        totalCalls: calls.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/calls/:callId
 *
 * Get a specific call by ID
 */
router.get('/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const call = getCall(callId);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found',
      });
    }

    res.json({
      success: true,
      data: {
        id: call.id,
        marketId: call.marketId,
        userWallet: call.userWallet,
        status: call.status,
        predictionHash: call.predictionHash,
        encryptedPrediction: call.encryptedPrediction.substring(0, 32) + '...',
        timestamp: call.timestamp,
        revealCondition: call.revealCondition,
        revealPrice: call.revealPrice,
        revealPriceSOL: `${call.revealPrice / 1e9} SOL`,
        revealedPrediction: call.status === 'revealed' ? call.revealedPrediction : undefined,
        revealedAt: call.revealedAt,
        revealedBy: call.revealedBy,
        onChain: {
          txSignature: call.onChain?.txSignature,
          explorerUrl: call.onChain?.explorerUrl,
          network: call.onChain?.network,
          verified: !!call.onChain?.txSignature,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/calls/:callId/payment-info
 *
 * Get payment information required to reveal a call
 * Frontend should use this to display payment instructions
 */
router.get('/:callId/payment-info', async (req, res) => {
  try {
    const { callId } = req.params;
    const call = getCall(callId);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found',
      });
    }

    if (call.status === 'revealed') {
      return res.status(400).json({
        success: false,
        error: 'Call already revealed',
      });
    }

    if (call.revealCondition === 'market_resolution') {
      return res.status(400).json({
        success: false,
        error: 'This call can only be revealed after market resolution',
      });
    }

    const paymentAddress = getPaymentRecipient();

    res.json({
      success: true,
      data: {
        callId: call.id,
        paymentAddress,
        requiredAmount: call.revealPrice,
        requiredAmountSOL: call.revealPrice / 1e9,
        requiredAmountDisplay: `${(call.revealPrice / 1e9).toFixed(4)} SOL (~$0.20)`,
        instructions: [
          `1. Send exactly ${(call.revealPrice / 1e9).toFixed(4)} SOL to ${paymentAddress}`,
          '2. Wait for transaction confirmation',
          '3. Submit the transaction signature to reveal the prediction',
        ],
        network: 'mainnet',
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/calls/:callId/reveal
 *
 * Reveal an encrypted call with VERIFIED payment
 * REQUIRES actual SOL payment to the platform wallet
 *
 * Body:
 * - payerWallet: string - Wallet address of the payer
 * - paymentSignature: string - Transaction signature of the SOL payment
 */
router.post('/:callId/reveal', async (req, res) => {
  try {
    const { callId } = req.params;
    const { payerWallet, paymentSignature } = req.body;

    if (!payerWallet || !paymentSignature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: payerWallet, paymentSignature',
      });
    }

    const result = await revealCallWithPayment(callId, payerWallet, paymentSignature);

    if (result.success && result.call) {
      res.json({
        success: true,
        data: {
          callId: result.call.id,
          revealedPrediction: result.call.revealedPrediction,
          revealedAt: result.call.revealedAt,
          revealedBy: result.call.revealedBy,
          onChain: {
            originalTx: result.call.onChain?.txSignature,
            explorerUrl: result.call.onChain?.explorerUrl,
          },
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/calls/market/:marketId/resolve
 *
 * Mark a market as resolved and reveal all calls
 * (This would normally be called by an oracle or admin)
 *
 * Body:
 * - outcome: string - The market outcome (e.g., 'YES', 'NO')
 */
router.post('/market/:marketId/resolve', async (req, res) => {
  try {
    const { marketId } = req.params;
    const { outcome } = req.body;

    if (!outcome) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: outcome',
      });
    }

    if (isMarketResolved(marketId)) {
      return res.status(400).json({
        success: false,
        error: 'Market already resolved',
      });
    }

    const result = await resolveMarket(marketId, outcome);

    if (result.success) {
      res.json({
        success: true,
        data: {
          marketId,
          outcome,
          revealedCalls: result.revealedCalls,
          message: `Market resolved! ${result.revealedCalls} predictions revealed.`,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/calls
 *
 * List all calls with pagination and filters
 *
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 * - status: 'encrypted' | 'revealed' | 'all' (default: 'all')
 * - marketId: string (optional filter)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as 'encrypted' | 'revealed' | 'all' | undefined;
    const marketId = req.query.marketId as string | undefined;

    const result = listCalls({ limit, offset, status: status || 'all', marketId });

    res.json({
      success: true,
      data: {
        calls: result.calls.map(c => ({
          id: c.id,
          marketId: c.marketId,
          userWallet: c.userWallet.substring(0, 8) + '...',
          status: c.status,
          timestamp: c.timestamp,
          revealCondition: c.revealCondition,
          revealPrice: c.revealPrice,
          revealPriceSOL: `${c.revealPrice / 1e9} SOL`,
          revealedPrediction: c.status === 'revealed' ? c.revealedPrediction : '🔒',
          onChain: {
            txSignature: c.onChain?.txSignature?.substring(0, 16) + '...',
            verified: !!c.onChain?.txSignature,
          },
        })),
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
