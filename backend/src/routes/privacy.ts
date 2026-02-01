import { Router } from 'express';
import {
  getPrivacyPoolStatus,
  getPrivacyDeposit,
  listPrivacyDeposits,
  privacyTransfer,
  privacyWithdraw,
  privacyFundWallet,
  getPrivacyWithdrawal,
  listPrivacyWithdrawals,
} from '../services/privacy-pool.js';
import { getWalletKeypair, getTradingWallet, getTradingWalletKeypair } from '../services/wallet.js';
import type { ApiResponse, PrivacyDeposit } from '../types/index.js';

const router = Router();

/**
 * PRIVACY POOL ROUTES
 *
 * All fund movements use privacy pools to break on-chain links:
 * - Deposits: Main Wallet → Privacy Pool → Trading Wallet
 * - Withdrawals: Trading Wallet → Privacy Pool → Main Wallet
 */

// Get privacy pool status
router.get('/status', async (_req, res) => {
  try {
    const status = getPrivacyPoolStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// DEPOSITS (Main → Trading)
// ============================================

// List all deposits
router.get('/deposits', async (_req, res) => {
  try {
    const deposits = listPrivacyDeposits();
    const response: ApiResponse<PrivacyDeposit[]> = { success: true, data: deposits };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single deposit
router.get('/deposits/:id', async (req, res) => {
  try {
    const deposit = getPrivacyDeposit(req.params.id);
    if (!deposit) {
      return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    const response: ApiResponse<PrivacyDeposit> = { success: true, data: deposit };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create privacy deposit (fund new wallet)
router.post('/deposit', async (req, res) => {
  try {
    const { amount, token, toWalletId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    if (!['sol', 'usdc'].includes(token)) {
      return res.status(400).json({ success: false, error: 'Token must be sol or usdc' });
    }

    const fromKeypair = getWalletKeypair(); // Main wallet
    const result = await privacyTransfer(fromKeypair, amount, token, toWalletId);

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

// Fund existing wallet via privacy pool
router.post('/fund', async (req, res) => {
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

// ============================================
// WITHDRAWALS (Trading → Main)
// ============================================

// List all withdrawals
router.get('/withdrawals', async (_req, res) => {
  try {
    const withdrawals = listPrivacyWithdrawals();
    res.json({ success: true, data: withdrawals });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single withdrawal
router.get('/withdrawals/:id', async (req, res) => {
  try {
    const withdrawal = getPrivacyWithdrawal(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    }
    res.json({ success: true, data: withdrawal });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create privacy withdrawal (from trading wallet to main)
router.post('/withdraw', async (req, res) => {
  try {
    const { fromWalletId, token = 'all' } = req.body;

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

    const result = await privacyWithdraw(fromWalletId, token, 'main');

    // Return error at root level if withdrawal failed (frontend expects data.error)
    if (!result.success) {
      return res.json({
        success: false,
        error: result.errors.length > 0 ? result.errors.join('; ') : 'Withdrawal failed',
        data: {
          operationId: result.operationId,
          amountWithdrawn: result.amountWithdrawn,
          token: result.token,
          destinationAddress: result.destinationAddress,
          errors: result.errors,
        },
      });
    }

    res.json({
      success: true,
      data: {
        operationId: result.operationId,
        amountWithdrawn: result.amountWithdrawn,
        token: result.token,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        intermediateWallet: result.intermediateWallet,
        destinationAddress: result.destinationAddress,
        privacyProtected: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
