import { Router } from 'express';
import { getWalletKeypair, getTradingWallet, getTradingWalletKeypair, getMainWalletKeypair } from '../services/wallet.js';
import {
  privacyTransfer,
  privacyWithdraw,
  privacyFundWallet,
  startBackgroundTransfer,
  getOperationStatus,
  getPendingOperations,
  recoverFailedOperation,
  recoverFromTradingWalletPool,
  scanAllPoolsForStuckFunds,
  getShieldedPoolBalance,
} from '../services/privacy-pool.js';
import { executePrivacyCashTransfer, getPrivacyCashFeeInfo } from '../services/privacy-cash.js';
import { executePrivateTransfer as executeShadowWireTransfer, getTransferFeeInfo as getShadowWireFeeInfo } from '../services/shadowwire.js';
import type { ApiResponse } from '../types/index.js';

// Privacy provider types
type PrivacyProvider = 'shadowwire' | 'privacycash';

const router = Router();

/**
 * IMPORTANT: All transfers MUST go through privacy pools.
 * Direct transfers are NOT allowed to maintain privacy guarantees.
 *
 * Flow for funding: Main Wallet → Privacy Pool → Trading Wallet
 * Flow for withdraw: Trading Wallet → Privacy Pool → Main Wallet
 *
 * Available providers:
 * - ShadowWire: ZK proofs with Bulletproofs (0.5% fee)
 * - Privacy Cash: Light Protocol compressed transactions (1% fee)
 */

// Get available privacy providers
router.get('/providers', (_req, res) => {
  res.json({
    success: true,
    data: {
      providers: [
        {
          id: 'shadowwire',
          name: 'ShadowWire',
          description: 'ZK shielded transfers using Bulletproof range proofs',
          feePercent: 0.5,
          minimumAmount: { SOL: 0.1, USDC: 5 },
          features: ['Amount hidden with ZK proofs', 'No on-chain link'],
        },
        {
          id: 'privacycash',
          name: 'Privacy Cash',
          description: 'Light Protocol compressed transactions with encryption',
          feePercent: 1,
          minimumAmount: { SOL: 0.01, USDC: 1 },
          features: ['Lower minimum amounts', 'Fast transactions'],
        },
      ],
      default: 'shadowwire',
    },
  });
});

// Fund trading wallet via privacy pool (Main → Trading)
router.post('/privacy/fund', async (req, res) => {
  try {
    const { toWalletId, amount, token } = req.body;

    if (!toWalletId) {
      return res.status(400).json({ success: false, error: 'toWalletId is required' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    if (!['sol', 'usdc'].includes(token)) {
      return res.status(400).json({ success: false, error: 'Token must be sol or usdc' });
    }

    // Verify wallet exists
    const wallet = getTradingWallet(toWalletId);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Trading wallet not found' });
    }

    // Use privacy pool to fund
    const result = await privacyFundWallet(toWalletId, amount, token);

    res.json({
      success: result.success,
      data: {
        operationId: result.operationId,
        tradingWalletId: result.tradingWalletId,
        tradingWalletAddress: result.tradingWalletAddress,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        intermediateWallet: result.intermediateWallet,
        privacyProtected: true,
      },
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Withdraw from trading wallet via privacy pool (Trading → Main)
// Includes Range compliance screening before withdrawal
router.post('/privacy/withdraw', async (req, res) => {
  try {
    const { fromWalletId, token = 'all', externalAddress, skipCompliance = false } = req.body;

    if (!fromWalletId) {
      return res.status(400).json({ success: false, error: 'fromWalletId is required' });
    }

    if (!['sol', 'usdc', 'all'].includes(token)) {
      return res.status(400).json({ success: false, error: 'Token must be sol, usdc, or all' });
    }

    // Verify wallet exists
    const keypair = getTradingWalletKeypair(fromWalletId);
    if (!keypair) {
      return res.status(404).json({ success: false, error: 'Trading wallet not found' });
    }

    // Determine destination type
    const destinationType = externalAddress ? 'external' : 'main';

    // Use privacy pool to withdraw (with compliance screening)
    const result = await privacyWithdraw(fromWalletId, token, destinationType, externalAddress, skipCompliance);

    // Check if blocked by compliance
    if (!result.success && result.compliance?.recommendation === 'block') {
      return res.status(403).json({
        success: false,
        error: result.errors[0] || 'Withdrawal blocked by compliance',
        compliance: result.compliance,
      });
    }

    res.json({
      success: result.success,
      data: {
        operationId: result.operationId,
        amountWithdrawn: result.amountWithdrawn,
        token: result.token,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        intermediateWallet: result.intermediateWallet,
        destinationAddress: result.destinationAddress,
        privacyProtected: true,
        compliance: result.compliance,
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Privacy transfer endpoint - supports provider selection
// provider: 'shadowwire' (default) or 'privacycash'
router.post('/privacy', async (req, res) => {
  try {
    const {
      amount,
      token,
      toWalletId,
      background = true,
      provider = 'shadowwire',
      usePrivacyPool = true,
    } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    if (!['sol', 'usdc'].includes(token)) {
      return res.status(400).json({ success: false, error: 'Token must be sol or usdc' });
    }

    // Validate provider
    if (!['shadowwire', 'privacycash'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid provider. Use "shadowwire" or "privacycash"',
      });
    }

    // Get target wallet address
    let targetAddress: string;
    if (toWalletId) {
      const wallet = getTradingWallet(toWalletId);
      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Trading wallet not found' });
      }
      targetAddress = wallet.address;
    } else {
      return res.status(400).json({ success: false, error: 'toWalletId is required' });
    }

    const mainWallet = getMainWalletKeypair();
    const senderAddress = mainWallet.publicKey.toBase58();

    // Route to appropriate provider
    if (provider === 'privacycash') {
      // Use Privacy Cash
      console.log(`[Transfer] Using Privacy Cash for ${amount} ${token}`);

      const result = await executePrivacyCashTransfer({
        sender: senderAddress,
        recipient: targetAddress,
        amount,
        token: token.toUpperCase() as 'SOL' | 'USDC',
      });

      return res.json({
        success: result.success,
        data: {
          provider: 'privacycash',
          depositTx: result.depositTx,
          withdrawTx: result.withdrawTx,
          fee: result.fee,
          netAmount: result.netAmount,
          targetWalletAddress: targetAddress,
          privacyProtected: true,
        },
        error: result.error,
      });
    }

    // Default: Use ShadowWire
    console.log(`[Transfer] Using ShadowWire for ${amount} ${token}`);

    // Use background transfer by default (returns immediately)
    if (background) {
      const result = await startBackgroundTransfer(amount, token, toWalletId);
      return res.json({
        success: result.success,
        data: result.operationId ? {
          provider: 'shadowwire',
          operationId: result.operationId,
          status: 'pending',
          message: 'Transfer started! You can close this window. Check status with GET /api/transfer/status/:operationId',
          privacyProtected: true,
        } : undefined,
        error: result.error,
      });
    }

    // Synchronous transfer
    const fromKeypair = getWalletKeypair(); // Main wallet
    const result = await privacyTransfer(fromKeypair, amount, token, toWalletId);

    res.json({
      success: result.success,
      data: {
        provider: 'shadowwire',
        operationId: result.operationId,
        tradingWalletId: result.tradingWalletId,
        tradingWalletAddress: result.tradingWalletAddress,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        intermediateWallet: result.intermediateWallet,
        privacyProtected: true,
      },
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get transfer status by operationId
router.get('/status/:operationId', async (req, res) => {
  try {
    const { operationId } = req.params;
    const operation = getOperationStatus(operationId);

    if (!operation) {
      return res.status(404).json({ success: false, error: 'Operation not found' });
    }

    res.json({
      success: true,
      data: {
        operationId: operation.operationId,
        status: operation.status,
        amount: operation.amount,
        token: operation.token,
        targetWalletAddress: operation.targetWalletAddress,
        depositSignature: operation.depositSignature,
        withdrawSignature: operation.withdrawSignature,
        error: operation.error,
        createdAt: operation.createdAt,
        isComplete: operation.status === 'completed',
        isFailed: operation.status === 'failed',
        isPending: ['pending', 'validating', 'funding', 'withdrawing'].includes(operation.status),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all pending operations
router.get('/pending', async (_req, res) => {
  try {
    const operations = getPendingOperations();
    res.json({
      success: true,
      data: operations.map(op => ({
        operationId: op.operationId,
        status: op.status,
        amount: op.amount,
        token: op.token,
        targetWalletAddress: op.targetWalletAddress,
        createdAt: op.createdAt,
        error: op.error,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recover failed operation
router.post('/recover/:operationId', async (req, res) => {
  try {
    const { operationId } = req.params;
    const result = await recoverFailedOperation(operationId);

    res.json({
      success: result.success,
      data: result.success ? {
        solRecovered: result.solRecovered,
        usdcRecovered: result.usdcRecovered,
        signature: result.signature,
      } : undefined,
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Recover funds stuck in a trading wallet's shielded pool
 * Use this when withdrawal deposited to pool but external transfer failed
 */
router.post('/recover/pool/:walletId', async (req, res) => {
  try {
    const { walletId } = req.params;
    const { destinationAddress } = req.body;

    console.log(`[Recovery API] Recovering funds from trading wallet ${walletId}`);

    const result = await recoverFromTradingWalletPool(walletId, destinationAddress);

    res.json({
      success: result.success,
      data: {
        solRecovered: result.solRecovered,
        usdcRecovered: result.usdcRecovered,
        solSignature: result.solSignature,
        usdcSignature: result.usdcSignature,
        poolBalances: result.poolBalances,
      },
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Check pool balance for a specific wallet
 */
router.get('/pool/balance/:walletId', async (req, res) => {
  try {
    const { walletId } = req.params;
    const tradingKeypair = getTradingWalletKeypair(walletId);

    if (!tradingKeypair) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const address = tradingKeypair.publicKey.toBase58();

    const [solBalance, usdcBalance] = await Promise.all([
      getShieldedPoolBalance(address, 'sol'),
      getShieldedPoolBalance(address, 'usdc'),
    ]);

    res.json({
      success: true,
      data: {
        walletId,
        walletAddress: address,
        poolBalances: {
          sol: solBalance?.available || 0,
          usdc: usdcBalance?.available || 0,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Scan all trading wallets for stuck funds
 */
router.get('/pool/scan', async (_req, res) => {
  try {
    const result = await scanAllPoolsForStuckFunds();

    res.json({
      success: true,
      data: {
        walletsChecked: result.walletsChecked,
        walletsWithFunds: result.walletsWithFunds,
        totalStuckSol: result.walletsWithFunds.reduce((sum, w) => sum + w.solInPool + w.solOnChain, 0),
        totalStuckUsdc: result.walletsWithFunds.reduce((sum, w) => sum + w.usdcInPool, 0),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DEPRECATED ENDPOINTS
 * These endpoints are kept for backward compatibility but will return errors
 * directing users to use privacy pool transfers instead.
 */

// Direct SOL transfer - DEPRECATED
router.post('/sol', async (_req, res) => {
  res.status(400).json({
    success: false,
    error: 'Direct transfers are disabled. Use /privacy/fund or /privacy/withdraw for privacy-protected transfers.',
    suggestion: 'POST /api/transfer/privacy/fund for Main→Trading, POST /api/transfer/privacy/withdraw for Trading→Main',
  });
});

// Direct USDC transfer - DEPRECATED
router.post('/usdc', async (_req, res) => {
  res.status(400).json({
    success: false,
    error: 'Direct transfers are disabled. Use /privacy/fund or /privacy/withdraw for privacy-protected transfers.',
    suggestion: 'POST /api/transfer/privacy/fund for Main→Trading, POST /api/transfer/privacy/withdraw for Trading→Main',
  });
});

// Direct fund - DEPRECATED
router.post('/fund', async (_req, res) => {
  res.status(400).json({
    success: false,
    error: 'Direct funding is disabled. Use /privacy/fund for privacy-protected transfers.',
    suggestion: 'POST /api/transfer/privacy/fund with { toWalletId, amount, token }',
  });
});

export default router;
