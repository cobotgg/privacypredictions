import { Router } from 'express';
import { config } from '../config/env.js';
import {
  executePrivateTransfer,
  getPrivacyBalance,
  createDepositTransaction,
  createWithdrawTransaction,
  executeWithdrawal,
  getTransferFeeInfo,
  calculateTransferFee,
  payAIAgent,
} from '../services/shadowwire.js';

const router = Router();

type SupportedToken = 'SOL' | 'USDC' | 'RADR' | 'USD1';

// Check if ShadowWire is enabled
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      enabled: config.shadowwireEnabled,
      supportedTokens: ['SOL', 'USDC', 'RADR', 'USD1'],
      features: {
        internalTransfer: 'Amount hidden with ZK proofs',
        externalTransfer: 'Anonymous sender, visible amount',
        deposit: 'Fund privacy pool',
        withdraw: 'Withdraw from privacy pool',
      },
    },
  });
});

// Get fee information
router.get('/fees', (req, res) => {
  const token = (req.query.token as SupportedToken) || 'SOL';

  try {
    const feeInfo = getTransferFeeInfo(token);
    res.json({
      success: true,
      data: feeInfo,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get fee info',
    });
  }
});

// Calculate fee for specific amount
router.get('/fees/calculate', (req, res) => {
  const amount = parseFloat(req.query.amount as string);
  const token = (req.query.token as SupportedToken) || 'SOL';

  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount',
    });
  }

  try {
    const breakdown = calculateTransferFee(amount, token);
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

// Get privacy pool balance
router.get('/balance/:wallet', async (req, res) => {
  const { wallet } = req.params;
  const token = (req.query.token as SupportedToken) || 'SOL';

  if (!config.shadowwireEnabled) {
    return res.status(503).json({
      success: false,
      error: 'ShadowWire is not enabled',
    });
  }

  try {
    const balance = await getPrivacyBalance(wallet, token);
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

// Execute private transfer
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

  if (!config.shadowwireEnabled) {
    return res.status(503).json({
      success: false,
      error: 'ShadowWire is not enabled',
    });
  }

  try {
    const result = await executePrivateTransfer({
      sender,
      recipient,
      amount,
      token,
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

// Create deposit transaction (unsigned)
router.post('/deposit', async (req, res) => {
  const { wallet, amount, token = 'SOL' } = req.body;

  if (!wallet || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: wallet, amount',
    });
  }

  if (!config.shadowwireEnabled) {
    return res.status(503).json({
      success: false,
      error: 'ShadowWire is not enabled',
    });
  }

  try {
    const result = await createDepositTransaction(wallet, amount, token);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create deposit',
    });
  }
});

// Create withdrawal transaction (unsigned)
router.post('/withdraw', async (req, res) => {
  const { wallet, amount, token = 'SOL' } = req.body;

  if (!wallet || !amount) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: wallet, amount',
    });
  }

  if (!config.shadowwireEnabled) {
    return res.status(503).json({
      success: false,
      error: 'ShadowWire is not enabled',
    });
  }

  try {
    const result = await createWithdrawTransaction(wallet, amount, token);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create withdrawal',
    });
  }
});

// Execute withdrawal from privacy pool (signed, recovers funds)
router.post('/recover', async (req, res) => {
  const { wallet, amount, token = 'USDC' } = req.body;

  if (!wallet) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: wallet',
    });
  }

  if (!config.shadowwireEnabled) {
    return res.status(503).json({
      success: false,
      error: 'ShadowWire is not enabled',
    });
  }

  try {
    // If no amount specified, get the full available balance
    let withdrawAmount = amount;
    if (!withdrawAmount) {
      const balance = await getPrivacyBalance(wallet, token);
      withdrawAmount = balance.available;
      if (withdrawAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'No funds available in pool to recover',
          balance,
        });
      }
    }

    const result = await executeWithdrawal(wallet, withdrawAmount, token);

    if (result.success) {
      res.json({
        success: true,
        data: {
          ...result,
          message: `Successfully recovered ${result.amountWithdrawn} ${token} from privacy pool`,
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
      error: error instanceof Error ? error.message : 'Recovery failed',
    });
  }
});

// Pay AI agent (special endpoint for AI interactions)
router.post('/pay-agent', async (req, res) => {
  const { userWallet, agentWallet, amount = 1 } = req.body;

  if (!userWallet || !agentWallet) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: userWallet, agentWallet',
    });
  }

  if (!config.shadowwireEnabled) {
    return res.status(503).json({
      success: false,
      error: 'ShadowWire is not enabled',
    });
  }

  try {
    const result = await payAIAgent(userWallet, agentWallet, amount);

    if (result.success) {
      res.json({
        success: true,
        data: {
          ...result,
          message: `Paid ${amount} USD1 to AI agent privately`,
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
      error: error instanceof Error ? error.message : 'AI agent payment failed',
    });
  }
});

export default router;
