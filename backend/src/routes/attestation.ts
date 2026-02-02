/**
 * Light Protocol Attestation API Routes
 *
 * Provides endpoints for creating and verifying on-chain attestations
 * of AI responses using Light Protocol's ZK Compression.
 */

import { Router } from 'express';
import {
  createAIResponseAttestation,
  verifyAttestation,
  getAttestation,
  listAttestations,
  getAttestationStatus,
  createBatchAttestations,
  attestedAIResponse,
} from '../services/light-attestation.js';
import { researchMarket, analyzeMarket } from '../services/ai-agent.js';

const router = Router();

/**
 * GET /api/attestation/status
 *
 * Get attestation service status
 */
router.get('/status', async (_req, res) => {
  try {
    const status = getAttestationStatus();
    res.json({
      success: true,
      data: {
        ...status,
        description: 'Light Protocol ZK Compression attestation service',
        features: [
          'On-chain AI response verification',
          'Tamper-proof attestations via Groth16 proofs',
          'Near-zero storage cost (only state root on-chain)',
          'Queryable via Photon indexer',
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
 * POST /api/attestation/create
 *
 * Create an on-chain attestation for an AI response
 *
 * Body:
 * - prompt: string - The original user prompt
 * - response: string - The AI-generated response
 * - modelId: string - The model that generated the response
 */
router.post('/create', async (req, res) => {
  try {
    const { prompt, response, modelId } = req.body;

    if (!prompt || !response) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: prompt, response',
      });
    }

    const result = await createAIResponseAttestation(
      prompt,
      response,
      modelId || 'unknown'
    );

    res.json({
      success: result.success,
      data: {
        attestationId: result.attestationId,
        txSignature: result.txSignature,
        dataHash: result.dataHash,
        timestamp: result.timestamp,
        explorerUrl: result.txSignature
          ? `https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`
          : null,
      },
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/attestation/batch
 *
 * Create multiple attestations in a batch (more efficient)
 *
 * Body:
 * - items: Array<{ prompt: string, response: string, modelId?: string }>
 */
router.post('/batch', async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid items array',
      });
    }

    if (items.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 items per batch',
      });
    }

    const result = await createBatchAttestations(items);

    res.json({
      success: result.success,
      data: {
        totalCreated: result.totalCreated,
        totalFailed: result.totalFailed,
        attestations: result.attestations.map(a => ({
          attestationId: a.attestationId,
          dataHash: a.dataHash,
          success: a.success,
          error: a.error,
        })),
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
 * GET /api/attestation/verify/:attestationId
 *
 * Verify an attestation exists and is valid on-chain
 */
router.get('/verify/:attestationId', async (req, res) => {
  try {
    const { attestationId } = req.params;

    const result = await verifyAttestation(attestationId);

    res.json({
      success: true,
      data: {
        valid: result.valid,
        attestation: result.attestation,
        error: result.error,
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
 * GET /api/attestation/:attestationId
 *
 * Get attestation details by ID
 */
router.get('/:attestationId', async (req, res) => {
  try {
    const { attestationId } = req.params;

    const attestation = getAttestation(attestationId);

    if (!attestation) {
      return res.status(404).json({
        success: false,
        error: 'Attestation not found',
      });
    }

    res.json({
      success: true,
      data: attestation,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/attestation/list
 *
 * List all attestations with pagination
 *
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 * - modelId: string (optional filter)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const modelId = req.query.modelId as string | undefined;

    const result = listAttestations({ limit, offset, modelId });

    res.json({
      success: true,
      data: {
        attestations: result.attestations,
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

/**
 * POST /api/attestation/ai/research
 *
 * Research a market with automatic attestation of the AI response
 *
 * Body:
 * - marketId: string - The market to research
 * - question: string - The research question
 */
router.post('/ai/research', async (req, res) => {
  try {
    const { marketId, question } = req.body;

    if (!marketId || !question) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: marketId, question',
      });
    }

    // Execute research with attestation
    const prompt = `Market: ${marketId}\nQuestion: ${question}`;

    const result = await attestedAIResponse(
      () => researchMarket(marketId, question),
      prompt,
      'gpt-4-turbo'
    );

    res.json({
      success: true,
      data: {
        research: result.result,
        attestation: {
          id: result.attestation.attestationId,
          dataHash: result.attestation.dataHash,
          txSignature: result.attestation.txSignature,
          verified: result.attestation.success,
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
 * POST /api/attestation/ai/analyze
 *
 * Analyze a market with automatic attestation
 *
 * Body:
 * - marketId: string - The market to analyze
 */
router.post('/ai/analyze', async (req, res) => {
  try {
    const { marketId } = req.body;

    if (!marketId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: marketId',
      });
    }

    // Get analysis
    const analysis = await analyzeMarket(marketId);

    // Create attestation for the analysis
    const attestation = await createAIResponseAttestation(
      `Analyze market: ${marketId}`,
      JSON.stringify(analysis),
      'gpt-4-turbo'
    );

    res.json({
      success: true,
      data: {
        analysis,
        attestation: {
          id: attestation.attestationId,
          dataHash: attestation.dataHash,
          txSignature: attestation.txSignature,
          verified: attestation.success,
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

export default router;
