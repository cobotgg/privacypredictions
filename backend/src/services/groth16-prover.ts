/**
 * Groth16 ZK Proof Service for AI Response Verification
 *
 * Generates REAL Groth16 proofs using snarkjs that can be verified on Solana.
 * Uses the circom circuit compiled with Powers of Tau ceremony.
 */

import * as snarkjs from 'snarkjs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// @ts-ignore - circomlibjs is ESM
import { buildPoseidon } from 'circomlibjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths to circuit artifacts
const CIRCUIT_DIR = join(__dirname, '../../circuits/groth16/build');
const WASM_PATH = join(CIRCUIT_DIR, 'ai_response_verifier_js/ai_response_verifier.wasm');
const ZKEY_PATH = join(CIRCUIT_DIR, 'ai_response_verifier_final.zkey');
const VKEY_PATH = join(CIRCUIT_DIR, 'verification_key.json');

// Cached Poseidon instance
let poseidonInstance: any = null;

/**
 * Initialize Poseidon hasher
 */
async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Convert a string to a field element (BN254 scalar field)
 */
function stringToField(str: string): bigint {
  const hash = crypto.createHash('sha256').update(str).digest();
  // Take first 31 bytes to ensure it's less than the field modulus
  const truncated = hash.subarray(0, 31);
  return BigInt('0x' + truncated.toString('hex'));
}

/**
 * Convert timestamp to field element
 */
function timestampToField(ts: number): bigint {
  return BigInt(ts);
}

/**
 * Groth16 proof structure
 */
export interface Groth16Proof {
  proofId: string;
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: 'groth16';
  };
  publicSignals: string[];
  // Formatted for Solana
  solanaProof: {
    a: number[];
    b: number[];
    c: number[];
    publicInputs: number[][];
  };
  verified: boolean;
  verifiedAt: string;
}

/**
 * Generate proof request
 */
export interface GenerateGroth16ProofRequest {
  query: {
    marketId: string;
    question: string;
    timestamp: number;
  };
  response: {
    content: string;
    model: string;
    generatedAt: string;
  };
}

/**
 * Generate a Groth16 proof for AI response verification
 */
export async function generateGroth16Proof(
  request: GenerateGroth16ProofRequest
): Promise<Groth16Proof> {
  const proofId = `groth16-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

  console.log(`[Groth16] Generating proof for market ${request.query.marketId}...`);

  // Get Poseidon hasher
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  // Convert inputs to field elements
  const marketIdField = stringToField(request.query.marketId);
  const questionHashField = stringToField(request.query.question);
  const timestampField = timestampToField(request.query.timestamp);
  const contentHashField = stringToField(request.response.content);
  const modelIdField = stringToField(request.response.model);
  const generatedAtField = stringToField(request.response.generatedAt);

  // Compute Poseidon hashes (matching circuit constraints)
  const queryCommitment = F.toObject(poseidon([marketIdField, questionHashField, timestampField]));
  const responseCommitment = F.toObject(poseidon([contentHashField, modelIdField, generatedAtField]));
  const merkleRoot = F.toObject(poseidon([queryCommitment, responseCommitment]));

  console.log(`[Groth16] Query commitment: ${queryCommitment.toString().substring(0, 20)}...`);
  console.log(`[Groth16] Response commitment: ${responseCommitment.toString().substring(0, 20)}...`);
  console.log(`[Groth16] Merkle root: ${merkleRoot.toString().substring(0, 20)}...`);

  // Circuit inputs
  const circuitInputs = {
    // Public inputs
    query_commitment: queryCommitment.toString(),
    response_commitment: responseCommitment.toString(),
    merkle_root: merkleRoot.toString(),
    timestamp: timestampField.toString(),
    // Private inputs
    market_id: marketIdField.toString(),
    question_hash: questionHashField.toString(),
    query_timestamp: timestampField.toString(),
    content_hash: contentHashField.toString(),
    model_id: modelIdField.toString(),
    generated_at: generatedAtField.toString(),
  };

  // Generate the proof
  console.log(`[Groth16] Computing witness and generating proof...`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    WASM_PATH,
    ZKEY_PATH
  );

  console.log(`[Groth16] Proof generated, verifying locally...`);

  // Verify the proof locally
  const vkey = JSON.parse(await readFile(VKEY_PATH, 'utf-8'));
  const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);

  console.log(`[Groth16] Proof verification: ${verified ? 'VALID' : 'INVALID'}`);

  // Format for Solana
  const solanaProof = formatProofForSolana(proof, publicSignals);

  return {
    proofId,
    proof: {
      pi_a: proof.pi_a,
      pi_b: proof.pi_b,
      pi_c: proof.pi_c,
      protocol: 'groth16',
    },
    publicSignals,
    solanaProof,
    verified,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * Format proof for Solana on-chain verification
 * Converts the proof points to byte arrays compatible with groth16-solana
 */
function formatProofForSolana(proof: any, publicSignals: string[]): {
  a: number[];
  b: number[];
  c: number[];
  publicInputs: number[][];
} {
  // Convert G1 point (pi_a, pi_c) to bytes
  const a = g1PointToBytes(proof.pi_a);
  const c = g1PointToBytes(proof.pi_c);

  // Convert G2 point (pi_b) to bytes
  const b = g2PointToBytes(proof.pi_b);

  // Convert public inputs to bytes
  const publicInputs = publicSignals.map(signal => fieldToBytes(BigInt(signal)));

  return { a, b, c, publicInputs };
}

/**
 * Convert G1 point [x, y, z] to 64 bytes
 */
function g1PointToBytes(point: string[]): number[] {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);

  return [...bigIntToBytes32(x), ...bigIntToBytes32(y)];
}

/**
 * Convert G2 point [[x0, x1], [y0, y1], [z0, z1]] to 128 bytes
 */
function g2PointToBytes(point: string[][]): number[] {
  const x0 = BigInt(point[0][0]);
  const x1 = BigInt(point[0][1]);
  const y0 = BigInt(point[1][0]);
  const y1 = BigInt(point[1][1]);

  return [
    ...bigIntToBytes32(x0),
    ...bigIntToBytes32(x1),
    ...bigIntToBytes32(y0),
    ...bigIntToBytes32(y1),
  ];
}

/**
 * Convert field element to 32 bytes
 */
function fieldToBytes(val: bigint): number[] {
  return bigIntToBytes32(val);
}

/**
 * Convert BigInt to 32 bytes (big-endian)
 */
function bigIntToBytes32(val: bigint): number[] {
  const hex = val.toString(16).padStart(64, '0');
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  }
  return bytes;
}

/**
 * Verify a Groth16 proof locally
 */
export async function verifyGroth16Proof(
  proof: Groth16Proof
): Promise<{ valid: boolean; error?: string }> {
  try {
    const vkey = JSON.parse(await readFile(VKEY_PATH, 'utf-8'));
    const groth16Proof = {
      pi_a: proof.proof.pi_a,
      pi_b: proof.proof.pi_b,
      pi_c: proof.proof.pi_c,
      protocol: 'groth16',
      curve: 'bn128',
    };

    const valid = await snarkjs.groth16.verify(vkey, proof.publicSignals, groth16Proof);
    return { valid };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Check if Groth16 prover is available
 */
export async function isGroth16Available(): Promise<boolean> {
  try {
    const fs = await import('fs');
    return fs.existsSync(WASM_PATH) && fs.existsSync(ZKEY_PATH) && fs.existsSync(VKEY_PATH);
  } catch {
    return false;
  }
}

/**
 * Get prover status
 */
export async function getGroth16Status(): Promise<{
  available: boolean;
  circuitPath: string;
  zkeyPath: string;
}> {
  return {
    available: await isGroth16Available(),
    circuitPath: WASM_PATH,
    zkeyPath: ZKEY_PATH,
  };
}
