import { Router } from 'express';
import { placeOrder, getPositions, closePosition, getTrendingMarkets } from '../services/dflow.js';
import {
  getWalletKeypair,
  getMainWalletAddress,
  listTradingWallets,
  getWalletPairKeypairs,
  getTradingWalletKeypairByAddress,
} from '../services/wallet.js';
import { analyzeMarket } from '../services/ai-agent.js';
import type { ApiResponse, Order, OrderResult, Position } from '../types/index.js';

const router = Router();

// ============================================
// SINGLE ORDER TRADING
// ============================================

// Place an order (ALWAYS uses privacy wallet)
router.post('/order', async (req, res) => {
  try {
    const order: Order = req.body;

    console.log(`[Trading Route] ========== ORDER REQUEST ==========`);
    console.log(`[Trading Route] Received order from frontend:`);
    console.log(`[Trading Route]   - marketId: ${order.marketId}`);
    console.log(`[Trading Route]   - side: ${order.side}`);
    console.log(`[Trading Route]   - amount: ${order.amount}`);
    console.log(`[Trading Route]   - usePrivacy: ${order.usePrivacy}`);
    console.log(`[Trading Route]   - walletId: ${order.walletId}`);

    if (!order.marketId || !order.side || !order.amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: marketId, side, amount',
      });
    }

    // ALWAYS use a trading wallet for privacy
    // Get the first available wallet pair's primary wallet
    const tradingWallets = await listTradingWallets();

    let keypair;
    let walletAddress;

    if (tradingWallets.length === 0) {
      // No trading wallets exist - create one automatically
      const { createWalletPair } = await import('../services/wallet.js');
      const newPair = await createWalletPair();
      const keypairs = getWalletPairKeypairs(newPair.id);
      if (!keypairs) {
        return res.status(500).json({
          success: false,
          error: 'Failed to create trading wallet',
        });
      }
      keypair = keypairs.primary;
      walletAddress = newPair.primaryWallet.address;
      console.log(`Auto-created trading wallet: ${walletAddress}`);
    } else {
      // Use the first available trading wallet
      const walletId = order.walletId || tradingWallets[0].id;
      keypair = getWalletKeypair(walletId);
      walletAddress = tradingWallets.find(w => w.id === walletId)?.address || tradingWallets[0].address;
    }

    console.log(`Placing order via privacy wallet: ${walletAddress}`);

    const result = await placeOrder(order, keypair);

    const response: ApiResponse<OrderResult> = {
      success: result.success,
      data: {
        ...result,
        walletAddress,
        privacyProtected: true,
      }
    };
    res.json(response);
  } catch (error: any) {
    console.error('Order error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// POSITIONS
// ============================================

// Get positions - ALWAYS fetch from trading wallets only (privacy wallets)
// Main wallet should never hold positions directly
router.get('/positions', async (req, res) => {
  try {
    const walletId = req.query.walletId as string | undefined;

    const allPositions: Position[] = [];
    const tradingWallets = await listTradingWallets();

    console.log(`[Positions] Fetching positions from ${tradingWallets.length} trading wallets`);

    for (const tw of tradingWallets) {
      if (!walletId || tw.id === walletId) {
        console.log(`[Positions] Fetching positions for trading wallet: ${tw.address}`);
        const twPositions = await getPositions(tw.address);
        console.log(`[Positions] Found ${twPositions.length} positions for ${tw.address}`);
        allPositions.push(...twPositions);
      }
    }

    console.log(`[Positions] Total positions found: ${allPositions.length}`);
    const response: ApiResponse<Position[]> = { success: true, data: allPositions };
    res.json(response);
  } catch (error: any) {
    console.error('[Positions] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Close a position
router.post('/close', async (req, res) => {
  try {
    const { positionMint, marketId, side, shares, walletId, walletAddress } = req.body;

    if (!positionMint || !marketId || !side || !shares) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: positionMint, marketId, side, shares',
      });
    }

    // Find the correct keypair - try walletAddress first (from position), then walletId
    let keypair;
    if (walletAddress) {
      // Position includes walletAddress - find the trading wallet that owns it
      keypair = getTradingWalletKeypairByAddress(walletAddress);
      if (!keypair) {
        console.log(`[Close] Trading wallet not found for address ${walletAddress}, trying main wallet`);
        // Check if it's the main wallet
        if (walletAddress === getMainWalletAddress()) {
          keypair = getWalletKeypair(); // Returns main wallet
        }
      } else {
        console.log(`[Close] Found trading wallet for address ${walletAddress}`);
      }
    }

    // Fallback to walletId if walletAddress didn't work
    if (!keypair && walletId) {
      keypair = getWalletKeypair(walletId);
    }

    // Final fallback to main wallet (will likely fail but provides clearer error)
    if (!keypair) {
      console.log('[Close] WARNING: No wallet specified, using main wallet (may fail if position owned by trading wallet)');
      keypair = getWalletKeypair();
    }

    console.log(`[Close] Closing position with wallet: ${keypair.publicKey.toBase58()}`);

    const result = await closePosition(
      positionMint,
      marketId,
      side as 'yes' | 'no',
      parseFloat(shares),
      keypair
    );

    const response: ApiResponse<OrderResult> = { success: result.success, data: result };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Redeem a won position
router.post('/redeem', async (req, res) => {
  try {
    const { positionMint, marketId, side, shares, walletId, walletAddress } = req.body;

    // Find the correct keypair - try walletAddress first, then walletId
    let keypair;
    if (walletAddress) {
      keypair = getTradingWalletKeypairByAddress(walletAddress);
      if (!keypair && walletAddress === getMainWalletAddress()) {
        keypair = getWalletKeypair();
      }
    }
    if (!keypair && walletId) {
      keypair = getWalletKeypair(walletId);
    }
    if (!keypair) {
      keypair = getWalletKeypair();
    }

    const result = await closePosition(
      positionMint,
      marketId,
      side as 'yes' | 'no',
      parseFloat(shares),
      keypair
    );

    const response: ApiResponse<OrderResult> = { success: result.success, data: result };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// MARKETS
// ============================================

// Get trending markets
router.get('/markets', async (req, res) => {
  try {
    const markets = await getTrendingMarkets();
    res.json({ success: true, data: markets });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// AI ANALYSIS
// ============================================

// Get AI analysis for a market
router.get('/analyze/:marketId', async (req, res) => {
  try {
    const { marketId } = req.params;
    const analysis = await analyzeMarket(marketId);
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
