import { Router } from 'express';
import { fetchMarkets, getTrendingMarkets, getMarket, getQuote } from '../services/dflow.js';
import { getMainWalletAddress } from '../services/wallet.js';
import type { ApiResponse, Market, MarketQuote } from '../types/index.js';

const router = Router();

// List active markets
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const markets = await fetchMarkets(limit);
    const response: ApiResponse<Market[]> = { success: true, data: markets };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trending markets
router.get('/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const markets = await getTrendingMarkets(limit);
    const response: ApiResponse<Market[]> = { success: true, data: markets };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single market
router.get('/:id', async (req, res) => {
  try {
    const market = await getMarket(req.params.id);
    if (!market) {
      return res.status(404).json({ success: false, error: 'Market not found' });
    }
    const response: ApiResponse<Market> = { success: true, data: market };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get quote for trade
router.get('/:id/quote', async (req, res) => {
  try {
    const { side, amount, wallet } = req.query;

    if (!side || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: side, amount',
      });
    }

    const walletAddress = (wallet as string) || getMainWalletAddress();
    const quote = await getQuote(
      req.params.id,
      side as 'yes' | 'no',
      parseFloat(amount as string),
      walletAddress
    );

    const response: ApiResponse<MarketQuote> = { success: true, data: quote };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
