import { Router, Request, Response } from 'express';
import { config } from '../config/env.js';

const router = Router();

const STARPAY_API_URL = 'https://www.starpay.cards/api/v1';

interface CardOrderRequest {
  amount?: number;
  cardType?: 'visa' | 'mastercard';
  email?: string;
}

interface StarpayOrderResponse {
  orderId: string;
  status: string;
  payment: {
    address: string;
    amountSol: number;
    solPrice: number;
  };
  pricing: {
    cardValue: number;
    starpayFeePercent: number;
    starpayFee: number;
    resellerMarkup: number;
    total: number;
  };
  feeTier: string;
  expiresAt: string;
  checkStatusUrl: string;
}

// GET /api/cards/price - Get pricing for a card amount
router.get('/price', async (req: Request, res: Response) => {
  try {
    if (!config.starpayApiKey) {
      return res.status(503).json({
        success: false,
        error: 'Starpay not configured',
      });
    }

    const amount = parseInt(req.query.amount as string) || config.starpayDefaultAmount;

    const response = await fetch(`${STARPAY_API_URL}/cards/price?amount=${amount}`, {
      headers: {
        'Authorization': `Bearer ${config.starpayApiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Starpay API error: ${error}`);
    }

    const data = await response.json();
    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error getting card price:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get card price',
    });
  }
});

// POST /api/cards/order - Create a new card order
router.post('/order', async (req: Request, res: Response) => {
  try {
    if (!config.starpayApiKey) {
      return res.status(503).json({
        success: false,
        error: 'Starpay not configured. Add STARPAY_API_KEY to environment.',
      });
    }

    const { amount, cardType, email }: CardOrderRequest = req.body;

    // Use defaults from config if not provided
    const orderAmount = amount || config.starpayDefaultAmount;
    const orderEmail = email || config.starpayCardEmail;

    if (!orderEmail) {
      return res.status(400).json({
        success: false,
        error: 'Email required. Provide email in request or set STARPAY_CARD_EMAIL in environment.',
      });
    }

    // Validate amount (Starpay supports $5-$10000)
    if (orderAmount < 5 || orderAmount > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Card amount must be between $5 and $10,000',
      });
    }

    const response = await fetch(`${STARPAY_API_URL}/cards/order`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.starpayApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: orderAmount,
        cardType: cardType || 'visa',
        email: orderEmail,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Starpay API error: ${error}`);
    }

    const data: StarpayOrderResponse = await response.json();

    res.json({
      success: true,
      data: {
        orderId: data.orderId,
        status: data.status,
        payment: {
          address: data.payment.address,
          amountSol: data.payment.amountSol,
          solPrice: data.payment.solPrice,
        },
        pricing: data.pricing,
        expiresAt: data.expiresAt,
      },
    });
  } catch (error) {
    console.error('Error creating card order:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create card order',
    });
  }
});

// GET /api/cards/order/status - Check order status
router.get('/order/status', async (req: Request, res: Response) => {
  try {
    if (!config.starpayApiKey) {
      return res.status(503).json({
        success: false,
        error: 'Starpay not configured',
      });
    }

    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'orderId required',
      });
    }

    const response = await fetch(
      `${STARPAY_API_URL}/cards/order/status?orderId=${orderId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.starpayApiKey}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Starpay API error: ${error}`);
    }

    const data = await response.json();
    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error checking order status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check order status',
    });
  }
});

// GET /api/cards/config - Get Starpay configuration status
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: !!config.starpayApiKey,
      defaultAmount: config.starpayDefaultAmount,
      emailConfigured: !!config.starpayCardEmail,
    },
  });
});

export default router;
