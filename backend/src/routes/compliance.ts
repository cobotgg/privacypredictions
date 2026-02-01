import { Router } from 'express';
import {
  isRangeEnabled,
  screenAddress,
  screenTransaction,
  getRiskColor,
} from '../services/range.js';

const router = Router();

// Check Range compliance status
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      enabled: isRangeEnabled(),
      provider: 'Range Security',
      description: 'Pre-transaction compliance screening for sanctioned addresses',
      riskLevels: ['low', 'medium', 'high', 'severe'],
    },
  });
});

// Screen a single address
router.get('/screen/address', async (req, res) => {
  const { address, chain = 'solana' } = req.query;

  if (!address) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: address',
    });
  }

  try {
    const result = await screenAddress(
      address as string,
      chain as 'solana' | 'ethereum'
    );

    res.json({
      success: true,
      data: {
        ...result,
        color: getRiskColor(result.riskLevel),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to screen address',
    });
  }
});

// Screen a transaction (both addresses)
router.post('/screen/transaction', async (req, res) => {
  const { fromAddress, toAddress, amount, token, chain = 'solana' } = req.body;

  if (!fromAddress || !toAddress) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: fromAddress, toAddress',
    });
  }

  try {
    const screening = await screenTransaction(
      fromAddress,
      toAddress,
      amount || 0,
      token || 'SOL',
      chain
    );

    res.json({
      success: true,
      data: {
        ...screening,
        fromRiskColor: getRiskColor(screening.fromRisk.riskLevel),
        toRiskColor: getRiskColor(screening.toRisk.riskLevel),
        overallRiskColor: getRiskColor(screening.overallRisk),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to screen transaction',
    });
  }
});

// Batch screen multiple addresses
router.post('/screen/batch', async (req, res) => {
  const { addresses, chain = 'solana' } = req.body;

  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({
      success: false,
      error: 'Missing required field: addresses (array)',
    });
  }

  if (addresses.length > 10) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 10 addresses per batch',
    });
  }

  try {
    const results = await Promise.all(
      addresses.map(addr => screenAddress(addr, chain))
    );

    const screenedAddresses = results.map((result) => ({
      ...result,
      color: getRiskColor(result.riskLevel),
    }));

    // Summary stats
    const summary = {
      total: screenedAddresses.length,
      lowRisk: screenedAddresses.filter(r => r.riskLevel === 'low').length,
      mediumRisk: screenedAddresses.filter(r => r.riskLevel === 'medium').length,
      highRisk: screenedAddresses.filter(r => r.riskLevel === 'high').length,
      severeRisk: screenedAddresses.filter(r => r.riskLevel === 'severe').length,
      sanctioned: screenedAddresses.filter(r => r.sanctions).length,
    };

    res.json({
      success: true,
      data: {
        results: screenedAddresses,
        summary,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to screen addresses',
    });
  }
});

export default router;
