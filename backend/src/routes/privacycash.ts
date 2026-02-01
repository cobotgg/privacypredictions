import { Router } from 'express';
import {
  executePrivacyCashTransfer,
  getPrivacyCashBalance,
  depositToPrivacyCash,
  withdrawFromPrivacyCash,
  getPrivacyCashFeeInfo,
  calculatePrivacyCashFee,
} from '../services/privacy-cash.js';

const router = Router();

// Check if Privacy Cash is available
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      enabled: true,
      provider: 'privacy-cash',
      supportedTokens: ['SOL', 'USDC'],
      features: {
        deposit: 'Deposit to privacy pool',
        withdraw: 'Withdraw from privacy pool to any address',
        transfer: 'Private transfer (deposit + withdraw)',
        balance: 'Check private pool balance',
      },
      description: 'Privacy Cash uses Light Protocol for ZK compressed transactions on Solana',
    },
  });
});

// Get fee information
router.get('/fees', (req, res) => {
  try {
    const feeInfo = getPrivacyCashFeeInfo();
    res.json({
      success: true,
      data: feeInfo,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get fee info',
    });
  }
});

// Calculate fee for specific amount
router.get('/fees/calculate', (req, res) => {
  const amount = parseFloat(req.query.amount as string);
  const token = ((req.query.token as string) || 'SOL').toUpperCase() as 'SOL' | 'USDC';

  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount',
    });
  }

  try {
    const breakdown = calculatePrivacyCashFee(amount, token);
    res.json({
      success: true,
      data: breakdown,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate fee',
    });
  }
});

// Get private balance in Privacy Cash pool
router.get('/balance/:wallet', async (req, res) => {
  const { wallet } = req.params;
  const token = ((req.query.token as string) || 'SOL').toUpperCase() as 'SOL' | 'USDC';

  try {
    const balance = await getPrivacyCashBalance(wallet, token);
    res.json({
      success: true,
      data: balance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get balance',
    });
  }
});

// Execute private transfer (deposit + withdraw in one call)
router.post('/transfer', async (req, res) => {
  const { sender, recipient, amount, token = 'SOL' } = req.body;

  if (!sender || !recipient || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: sender, recipient, amount',
    });
  }

  if (amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Amount must be greater than 0',
    });
  }

  try {
    const result = await executePrivacyCashTransfer({
      sender,
      recipient,
      amount,
      token: token.toUpperCase() as 'SOL' | 'USDC',
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
        data: result,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Transfer failed',
    });
  }
});

// Deposit to Privacy Cash pool
router.post('/deposit', async (req, res) => {
  const { wallet, amount, token = 'SOL' } = req.body;

  if (!wallet || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: wallet, amount',
    });
  }

  try {
    const result = await depositToPrivacyCash(
      wallet,
      amount,
      token.toUpperCase() as 'SOL' | 'USDC'
    );

    if (result.success) {
      res.json({
        success: true,
        data: {
          tx: result.tx,
          amount,
          token,
          provider: 'privacy-cash',
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Deposit failed',
    });
  }
});

// Withdraw from Privacy Cash pool
router.post('/withdraw', async (req, res) => {
  const { wallet, amount, recipientAddress, token = 'SOL' } = req.body;

  if (!wallet || !amount || !recipientAddress) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: wallet, amount, recipientAddress',
    });
  }

  try {
    const result = await withdrawFromPrivacyCash(
      wallet,
      amount,
      recipientAddress,
      token.toUpperCase() as 'SOL' | 'USDC'
    );

    if (result.success) {
      res.json({
        success: true,
        data: {
          tx: result.tx,
          amount,
          recipientAddress,
          token,
          provider: 'privacy-cash',
        },
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Withdraw failed',
    });
  }
});

export default router;
