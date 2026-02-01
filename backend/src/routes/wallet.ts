import { Router } from 'express';
import {
  getMainWalletInfo,
  getWalletBalance,
  createTradingWallet,
  listTradingWallets,
  deleteTradingWallet,
  getTradingWallet,
  createWalletPair,
  listWalletPairs,
  deleteWalletPair,
  getWalletPair,
  getTradingWalletKeypair,
  getWalletPairKeypairs,
  getMainWalletKeypair,
} from '../services/wallet.js';
import { privacyWithdraw } from '../services/privacy-pool.js';
import type { ApiResponse, WalletInfo, TradingWallet } from '../types/index.js';
import type { WalletPair } from '../services/wallet.js';

const router = Router();

/**
 * IMPORTANT: All withdrawals use privacy pools to maintain privacy guarantees.
 * Trading Wallet → Privacy Pool → Main Wallet (no direct transfers)
 */

// Get main wallet info
router.get('/', async (_req, res) => {
  try {
    const wallet = await getMainWalletInfo();
    const response: ApiResponse<WalletInfo> = { success: true, data: wallet };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get main wallet balance
router.get('/balance', async (_req, res) => {
  try {
    const wallet = await getMainWalletInfo();
    res.json({
      success: true,
      data: {
        sol: wallet.solBalance,
        usdc: wallet.usdcBalance,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// WALLET PAIRS (Primary Trading + Batch POC)
// ============================================

// List all wallet pairs
router.get('/pairs', async (_req, res) => {
  try {
    const pairs = await listWalletPairs();
    const response: ApiResponse<WalletPair[]> = { success: true, data: pairs };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create a new wallet pair (Primary Trading + Batch Trading POC)
router.post('/pairs', async (_req, res) => {
  try {
    const pair = createWalletPair();

    // Don't expose private keys in response by default
    const safePair = {
      ...pair,
      primaryWallet: { ...pair.primaryWallet, privateKey: '***' },
      batchWallet: { ...pair.batchWallet, privateKey: '***' },
    };

    res.json({ success: true, data: safePair });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a specific wallet pair
router.get('/pairs/:id', async (req, res) => {
  try {
    const pair = getWalletPair(req.params.id);
    if (!pair) {
      return res.status(404).json({ success: false, error: 'Wallet pair not found' });
    }

    // Get balances for both wallets
    const [primaryBal, batchBal] = await Promise.all([
      getWalletBalance(pair.primaryWallet.address),
      getWalletBalance(pair.batchWallet.address),
    ]);

    const safePair = {
      ...pair,
      primaryWallet: {
        ...pair.primaryWallet,
        privateKey: '***',
        solBalance: primaryBal.sol,
        usdcBalance: primaryBal.usdc,
      },
      batchWallet: {
        ...pair.batchWallet,
        privateKey: '***',
        solBalance: batchBal.sol,
        usdcBalance: batchBal.usdc,
      },
    };

    res.json({ success: true, data: safePair });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export private keys for a wallet pair
// WARNING: This exposes sensitive data - only use when necessary
router.post('/pairs/:id/export', async (req, res) => {
  try {
    const { confirmExport } = req.body;

    // Require explicit confirmation
    if (confirmExport !== 'EXPORT') {
      return res.status(400).json({
        success: false,
        error: 'Export requires confirmation. Send confirmExport: "EXPORT"',
      });
    }

    const pair = getWalletPair(req.params.id);
    if (!pair) {
      return res.status(404).json({ success: false, error: 'Wallet pair not found' });
    }

    // Return full wallet data including private keys
    res.json({
      success: true,
      data: {
        pairId: pair.id,
        createdAt: pair.createdAt,
        primary: {
          id: pair.primaryWallet.id,
          label: pair.primaryWallet.label,
          address: pair.primaryWallet.address,
          privateKey: pair.primaryWallet.privateKey,
        },
        batch: {
          id: pair.batchWallet.id,
          label: pair.batchWallet.label,
          address: pair.batchWallet.address,
          privateKey: pair.batchWallet.privateKey,
        },
      },
      warning: 'NEVER share these private keys. Anyone with these keys can steal your funds.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Withdraw funds from a wallet pair to main wallet VIA PRIVACY POOL
router.post('/pairs/:id/withdraw', async (req, res) => {
  try {
    const {
      walletType = 'all',  // 'primary', 'batch', or 'all'
      token = 'all'        // 'sol', 'usdc', or 'all'
    } = req.body;

    const pair = getWalletPair(req.params.id);
    if (!pair) {
      return res.status(404).json({ success: false, error: 'Wallet pair not found' });
    }

    const results: any[] = [];
    const mainWallet = getMainWalletKeypair();

    // Withdraw from primary wallet via privacy pool
    if (walletType === 'primary' || walletType === 'all') {
      const result = await privacyWithdraw(pair.primaryWallet.id, token, 'main');
      results.push({
        wallet: 'primary',
        walletId: pair.primaryWallet.id,
        success: result.success,
        amountWithdrawn: result.amountWithdrawn,
        token: result.token,
        intermediateWallet: result.intermediateWallet,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        privacyProtected: true,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    }

    // Withdraw from batch wallet via privacy pool
    if (walletType === 'batch' || walletType === 'all') {
      const result = await privacyWithdraw(pair.batchWallet.id, token, 'main');
      results.push({
        wallet: 'batch',
        walletId: pair.batchWallet.id,
        success: result.success,
        amountWithdrawn: result.amountWithdrawn,
        token: result.token,
        intermediateWallet: result.intermediateWallet,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        privacyProtected: true,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    }

    const allSuccess = results.every(r => r.success);
    const allErrors = results.flatMap(r => r.errors || []);

    // Return error at root level if any withdrawal failed (frontend expects data.error)
    if (!allSuccess) {
      return res.json({
        success: false,
        error: allErrors.length > 0 ? allErrors.join('; ') : 'One or more withdrawals failed',
        data: {
          pairId: pair.id,
          withdrawals: results,
          mainWalletAddress: mainWallet.publicKey.toBase58(),
          privacyProtected: false,
        },
      });
    }

    res.json({
      success: true,
      data: {
        pairId: pair.id,
        withdrawals: results,
        mainWalletAddress: mainWallet.publicKey.toBase58(),
        privacyProtected: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Close/Delete a wallet pair (only after withdraw)
router.delete('/pairs/:id', async (req, res) => {
  try {
    const pair = getWalletPair(req.params.id);
    if (!pair) {
      return res.status(404).json({ success: false, error: 'Wallet pair not found' });
    }

    // Check if wallets have remaining balance
    const [primaryBal, batchBal] = await Promise.all([
      getWalletBalance(pair.primaryWallet.address),
      getWalletBalance(pair.batchWallet.address),
    ]);

    const hasBalance = (primaryBal.sol > 0.001 || primaryBal.usdc > 0) ||
                       (batchBal.sol > 0.001 || batchBal.usdc > 0);

    // Warn if wallets still have funds
    if (hasBalance && req.query.force !== 'true') {
      return res.status(400).json({
        success: false,
        error: 'Wallet pair still has funds. Withdraw first or add ?force=true to delete anyway.',
        balances: {
          primary: primaryBal,
          batch: batchBal,
        },
      });
    }

    const deleted = deleteWalletPair(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Failed to delete wallet pair' });
    }

    res.json({
      success: true,
      message: 'Wallet pair deleted successfully',
      warning: hasBalance ? 'Funds may have been lost - wallets had remaining balance' : undefined,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// SINGLE TRADING WALLETS
// ============================================

// List trading wallets
router.get('/trading', async (_req, res) => {
  try {
    const wallets = await listTradingWallets();
    const response: ApiResponse<TradingWallet[]> = { success: true, data: wallets };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create trading wallet
router.post('/trading', async (req, res) => {
  try {
    const { label } = req.body;
    const wallet = createTradingWallet(label);

    // Don't expose private key in response
    const safeWallet = { ...wallet, privateKey: undefined };

    res.json({ success: true, data: safeWallet });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trading wallet by ID
router.get('/trading/:id', async (req, res) => {
  try {
    const wallet = getTradingWallet(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Trading wallet not found' });
    }

    const { sol, usdc } = await getWalletBalance(wallet.address);
    const safeWallet = {
      ...wallet,
      privateKey: undefined,
      solBalance: sol,
      usdcBalance: usdc,
    };

    res.json({ success: true, data: safeWallet });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export private key for a trading wallet
router.post('/trading/:id/export', async (req, res) => {
  try {
    const { confirmExport } = req.body;

    if (confirmExport !== 'EXPORT') {
      return res.status(400).json({
        success: false,
        error: 'Export requires confirmation. Send confirmExport: "EXPORT"',
      });
    }

    const wallet = getTradingWallet(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Trading wallet not found' });
    }

    res.json({
      success: true,
      data: {
        id: wallet.id,
        label: wallet.label,
        address: wallet.address,
        privateKey: wallet.privateKey,
      },
      warning: 'NEVER share this private key. Anyone with this key can steal your funds.',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Withdraw funds from trading wallet to main wallet VIA PRIVACY POOL
router.post('/trading/:id/withdraw', async (req, res) => {
  try {
    const { token = 'all' } = req.body;
    const walletId = req.params.id;

    const wallet = getTradingWallet(walletId);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Trading wallet not found' });
    }

    // Use privacy pool for withdrawal
    const result = await privacyWithdraw(walletId, token, 'main');
    const mainWallet = getMainWalletKeypair();

    // Return error at root level if withdrawal failed (frontend expects data.error)
    if (!result.success) {
      return res.json({
        success: false,
        error: result.errors.length > 0 ? result.errors.join('; ') : 'Withdrawal failed',
        data: {
          walletId: wallet.id,
          amountWithdrawn: result.amountWithdrawn,
          token: result.token,
          errors: result.errors,
        },
      });
    }

    res.json({
      success: true,
      data: {
        walletId: wallet.id,
        amountWithdrawn: result.amountWithdrawn,
        token: result.token,
        intermediateWallet: result.intermediateWallet,
        depositSignature: result.depositSignature,
        withdrawSignature: result.withdrawSignature,
        mainWalletAddress: mainWallet.publicKey.toBase58(),
        privacyProtected: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete trading wallet
router.delete('/trading/:id', async (req, res) => {
  try {
    const wallet = getTradingWallet(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Trading wallet not found' });
    }

    const { sol, usdc } = await getWalletBalance(wallet.address);
    const hasBalance = sol > 0.001 || usdc > 0;

    if (hasBalance && req.query.force !== 'true') {
      return res.status(400).json({
        success: false,
        error: 'Wallet still has funds. Withdraw first or add ?force=true to delete anyway.',
        balance: { sol, usdc },
      });
    }

    const deleted = deleteTradingWallet(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Failed to delete wallet' });
    }

    res.json({
      success: true,
      message: 'Trading wallet deleted successfully',
      warning: hasBalance ? 'Funds may have been lost - wallet had remaining balance' : undefined,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
