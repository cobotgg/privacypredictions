import { Router } from 'express';
import { Keypair } from '@solana/web3.js';
import { isAIAvailable, analyzeMarket, getSuggestions, executeNaturalLanguageCommand, researchMarket } from '../services/ai-agent.js';
import { generateAIResponseProof, verifyAIResponseProof, formatProofForDisplay, isNoirProverAvailable } from '../services/noir-prover.js';
import {
  initConnection,
  verifyProofOnChain,
  checkProofVerification,
  batchVerifyProofsOnChain,
  getVerificationUrl,
  type OnChainProofData,
} from '../services/onchain-verifier.js';
import {
  initArciumClient,
  isArciumAvailable,
  getArciumStatus,
  getMxePublicKey,
} from '../services/arcium-client.js';
import { createAIResponseAttestation } from '../services/light-attestation.js';
import { config } from '../config/env.js';
import type { ApiResponse, AIAnalysis } from '../types/index.js';

const router = Router();

// Initialize Solana connection and Arcium client on module load
let solanaInitialized = false;
let payerKeypair: Keypair | null = null;

function ensureInitialized(): boolean {
  if (!solanaInitialized) {
    try {
      initConnection(config.solanaRpcUrl);
      initArciumClient(config.solanaRpcUrl, 0); // Cluster offset 0 for mainnet

      // Load payer keypair from config
      const privateKeyBytes = JSON.parse(config.mainWalletPrivateKey);
      payerKeypair = Keypair.fromSecretKey(new Uint8Array(privateKeyBytes));

      solanaInitialized = true;
      console.log('[AI Routes] Solana and Arcium clients initialized');
    } catch (error) {
      console.error('[AI Routes] Failed to initialize clients:', error);
      return false;
    }
  }
  return true;
}

// Check AI availability and privacy features
router.get('/status', async (_req, res) => {
  ensureInitialized();

  const arciumStatus = getArciumStatus();
  let mxeKeyPreview = 'not-available';
  try {
    if (isArciumAvailable()) {
      const mxeKey = getMxePublicKey();
      mxeKeyPreview = Buffer.from(mxeKey.slice(0, 8)).toString('hex') + '...';
    }
  } catch {
    // Ignore
  }

  res.json({
    success: true,
    data: {
      available: isAIAvailable(),
      model: 'gpt-4-turbo-preview',
      privacy: {
        arciumEncryption: isArciumAvailable(),
        arciumClusterOffset: arciumStatus.clusterOffset,
        noirProofs: isNoirProverAvailable(),
        mxeKeyId: mxeKeyPreview,
      },
      onChainVerification: {
        enabled: solanaInitialized,
        programId: 'ZKVer1fy111111111111111111111111111111111111',
        network: 'mainnet',
      },
    },
  });
});

// Analyze a market
router.post('/analyze', async (req, res) => {
  try {
    if (!isAIAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'AI not configured. Set OPENAI_API_KEY in environment.',
      });
    }

    const { marketId } = req.body;
    if (!marketId) {
      return res.status(400).json({ success: false, error: 'Missing marketId' });
    }

    const analysis = await analyzeMarket(marketId);
    const response: ApiResponse<AIAnalysis> = { success: true, data: analysis };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get trade suggestions
router.get('/suggest', async (_req, res) => {
  try {
    if (!isAIAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'AI not configured. Set OPENAI_API_KEY in environment.',
      });
    }

    const suggestions = await getSuggestions();
    const response: ApiResponse<AIAnalysis[]> = { success: true, data: suggestions };
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute natural language command
router.post('/command', async (req, res) => {
  try {
    if (!isAIAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'AI not configured. Set OPENAI_API_KEY in environment.',
      });
    }

    const { command } = req.body;
    if (!command) {
      return res.status(400).json({ success: false, error: 'Missing command' });
    }

    const result = await executeNaturalLanguageCommand(command);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Research a market - answer user questions about a specific market
// Supports encrypted queries (Arcium) and generates ZK proofs (Noir)
// Can optionally submit proofs on-chain for permanent verification
router.post('/research', async (req, res) => {
  try {
    if (!isAIAvailable()) {
      return res.status(400).json({
        success: false,
        error: 'AI not configured. Set OPENAI_API_KEY in environment.',
      });
    }

    const { marketId, question, marketContext, encrypted, generateProof = true, verifyOnChain = false } = req.body;

    // Handle encrypted queries (Arcium)
    let actualQuestion = question;
    let encryptedQueryData = null;

    if (encrypted) {
      // Note: In production, this would forward to Arcium MPC for decryption
      // For POC, we log that encryption was used but use the provided question
      console.log(`[AI Research] Received encrypted query for ${marketId}`);
      console.log(`[AI Research] Query hash: ${encrypted.queryHash}`);
      console.log(`[AI Research] MXE key used: ${encrypted.metadata?.mxeKeyId}`);

      encryptedQueryData = {
        ciphertext: encrypted.ciphertext?.substring(0, 32) + '...',
        queryHash: encrypted.queryHash,
      };

      // In production: actualQuestion = await arciumMpc.decrypt(encrypted);
      // For POC: Use the plaintext question that was also sent
    }

    if (!marketId || !actualQuestion) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: marketId, question',
      });
    }

    const timestamp = Date.now();

    // Get AI response
    const result = await researchMarket(marketId, actualQuestion, marketContext);

    // Generate Noir ZK proof if requested
    let zkProof = null;
    if (generateProof) {
      try {
        const proofResult = await generateAIResponseProof({
          encryptedQuery: encryptedQueryData || undefined,
          query: {
            marketId,
            question: actualQuestion,
            timestamp,
          },
          response: {
            content: result.response,
            model: 'gpt-4-turbo-preview',
            generatedAt: new Date().toISOString(),
          },
        });

        zkProof = {
          ...formatProofForDisplay(proofResult),
          raw: {
            proofId: proofResult.proofId,
            publicInputs: proofResult.publicInputs,
            merkleRoot: proofResult.merkleRoot,
            proof: proofResult.proof.data.substring(0, 64) + '...',
            verificationKey: proofResult.proof.verificationKey,
          },
          onChain: null as null | { verified: boolean; proofRecordAddress?: string; signature?: string; explorerUrl?: string; error?: string },
        };

        console.log(`[AI Research] Generated ZK proof: ${proofResult.proofId}`);

        // Submit to on-chain verification if requested
        if (verifyOnChain && zkProof && payerKeypair) {
          try {
            ensureInitialized();

            const onChainProofData: OnChainProofData = {
              proofId: proofResult.proofId,
              queryCommitment: proofResult.publicInputs.queryCommitment || '0',
              responseCommitment: proofResult.publicInputs.responseCommitment || '0',
              merkleRoot: proofResult.merkleRoot,
              timestamp: timestamp,
              proofData: proofResult.proof.data,
              verificationKey: proofResult.proof.verificationKey,
            };

            const onChainResult = await verifyProofOnChain(onChainProofData, marketId, payerKeypair);

            if (onChainResult.success) {
              zkProof.onChain = {
                verified: true,
                proofRecordAddress: onChainResult.proofRecordAddress,
                signature: onChainResult.signature,
                explorerUrl: getVerificationUrl(proofResult.proofId),
              };
              console.log(`[AI Research] On-chain verification successful: ${onChainResult.signature}`);
            } else {
              zkProof.onChain = {
                verified: false,
                error: onChainResult.error,
              };
              console.error(`[AI Research] On-chain verification failed: ${onChainResult.error}`);
            }
          } catch (onChainError: any) {
            console.error(`[AI Research] On-chain submission failed: ${onChainError.message}`);
            zkProof.onChain = {
              verified: false,
              error: onChainError.message,
            };
          }
        }
      } catch (proofError: any) {
        console.error(`[AI Research] Proof generation failed: ${proofError.message}`);
        // Continue without proof - don't fail the request
      }
    }

    // Create Light Protocol on-chain attestation for every AI response
    let lightAttestation = null;
    try {
      const attestationPrompt = `Market: ${marketId}\nQuestion: ${actualQuestion}`;
      const attestationResult = await createAIResponseAttestation(
        attestationPrompt,
        result.response,
        'gpt-4-turbo-preview'
      );

      lightAttestation = {
        success: attestationResult.success,
        attestationId: attestationResult.attestationId,
        dataHash: attestationResult.dataHash,
        txSignature: attestationResult.txSignature,
        timestamp: attestationResult.timestamp,
        explorerUrl: attestationResult.txSignature
          ? `https://explorer.solana.com/tx/${attestationResult.txSignature}?cluster=devnet`
          : null,
        error: attestationResult.error,
      };

      console.log(`[AI Research] Light Protocol attestation created: ${attestationResult.attestationId}`);
    } catch (attestError: any) {
      console.error(`[AI Research] Light attestation failed: ${attestError.message}`);
      lightAttestation = {
        success: false,
        error: attestError.message,
      };
    }

    res.json({
      success: true,
      data: {
        ...result,
        privacy: {
          encrypted: !!encrypted,
          encryptionMethod: encrypted ? 'Arcium x25519 ECDH' : null,
          queryHash: encryptedQueryData?.queryHash || null,
        },
        zkProof,
        lightProtocolAttestation: lightAttestation,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify a ZK proof (off-chain)
router.post('/verify-proof', async (req, res) => {
  try {
    const { proof, query, response } = req.body;

    if (!proof) {
      return res.status(400).json({
        success: false,
        error: 'Missing proof data',
      });
    }

    const result = await verifyAIResponseProof(proof, query, response);

    res.json({
      success: true,
      data: {
        valid: result.valid,
        error: result.error,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit a proof for on-chain verification
router.post('/verify-onchain', async (req, res) => {
  try {
    ensureInitialized();

    if (!payerKeypair) {
      return res.status(500).json({
        success: false,
        error: 'Payer keypair not initialized',
      });
    }

    const { proofId, marketId, queryCommitment, responseCommitment, merkleRoot, timestamp, proofData, verificationKey } = req.body;

    if (!proofId || !marketId || !proofData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: proofId, marketId, proofData',
      });
    }

    const onChainProofData: OnChainProofData = {
      proofId,
      queryCommitment: queryCommitment || '0',
      responseCommitment: responseCommitment || '0',
      merkleRoot: merkleRoot || '0',
      timestamp: timestamp || Date.now(),
      proofData,
      verificationKey: verificationKey || '0',
    };

    const result = await verifyProofOnChain(onChainProofData, marketId, payerKeypair);

    res.json({
      success: result.success,
      data: result.success ? {
        verified: result.verified,
        proofRecordAddress: result.proofRecordAddress,
        signature: result.signature,
        explorerUrl: getVerificationUrl(proofId),
      } : undefined,
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check on-chain verification status of a proof
router.get('/verify-onchain/:proofId', async (req, res) => {
  try {
    ensureInitialized();

    const { proofId } = req.params;

    if (!proofId) {
      return res.status(400).json({
        success: false,
        error: 'Missing proofId',
      });
    }

    const status = await checkProofVerification(proofId);

    res.json({
      success: true,
      data: {
        proofId,
        verified: status.verified,
        verifiedAt: status.timestamp,
        verifier: status.verifier,
        explorerUrl: getVerificationUrl(proofId),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch verify multiple proofs on-chain
router.post('/batch-verify-onchain', async (req, res) => {
  try {
    ensureInitialized();

    if (!payerKeypair) {
      return res.status(500).json({
        success: false,
        error: 'Payer keypair not initialized',
      });
    }

    const { batchId, proofs, batchMerkleRoot } = req.body;

    if (!batchId || !proofs || !Array.isArray(proofs) || proofs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: batchId, proofs (array)',
      });
    }

    if (proofs.length > 32) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 32 proofs per batch',
      });
    }

    const onChainProofs: OnChainProofData[] = proofs.map((p: any) => ({
      proofId: p.proofId,
      queryCommitment: p.queryCommitment || '0',
      responseCommitment: p.responseCommitment || '0',
      merkleRoot: p.merkleRoot || '0',
      timestamp: p.timestamp || Date.now(),
      proofData: p.proofData,
      verificationKey: p.verificationKey || '0',
    }));

    const result = await batchVerifyProofsOnChain(
      batchId,
      onChainProofs,
      batchMerkleRoot || '0',
      payerKeypair
    );

    res.json({
      success: result.success,
      data: result.success ? {
        batchId,
        proofCount: result.proofCount,
        batchRecordAddress: result.batchRecordAddress,
        signature: result.signature,
      } : undefined,
      error: result.error,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Arcium MXE public key for client-side encryption
router.get('/arcium/mxe-key', async (_req, res) => {
  try {
    ensureInitialized();

    if (!isArciumAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Arcium client not available',
      });
    }

    const mxeKey = getMxePublicKey();

    res.json({
      success: true,
      data: {
        mxePublicKey: Buffer.from(mxeKey).toString('hex'),
        algorithm: 'x25519',
        usage: 'encryption',
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
