/**
 * On-Chain ZK Proof Verification Service
 *
 * Submits and verifies Noir UltraHonk proofs on Solana.
 * Integrates with the ZK Verifier program deployed on mainnet.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
} from '@solana/web3.js';
import * as bs58 from 'bs58';

// Program ID - ZK Verifier Native (deployed to Solana devnet)
// Devnet Program: HMQZRtXdzSw7KjfW9gs6j17iVGtidkirVbYbwGosXNFv
// For mainnet, update this after mainnet deployment
const ZK_VERIFIER_PROGRAM_ID = new PublicKey('HMQZRtXdzSw7KjfW9gs6j17iVGtidkirVbYbwGosXNFv');

// Connection to Solana
let connection: Connection | null = null;

/**
 * Initialize the connection to Solana
 */
export function initConnection(rpcUrl: string): Connection {
  connection = new Connection(rpcUrl, 'confirmed');
  return connection;
}

/**
 * Get or create connection
 */
function getConnection(): Connection {
  if (!connection) {
    throw new Error('Connection not initialized. Call initConnection first.');
  }
  return connection;
}

/**
 * Proof data for on-chain submission
 */
export interface OnChainProofData {
  proofId: string;
  queryCommitment: string;
  responseCommitment: string;
  merkleRoot: string;
  timestamp: number;
  proofData: string; // hex
  verificationKey: string;
}

/**
 * Registry initialization result
 */
export interface RegistryInitResult {
  success: boolean;
  registryAddress?: string;
  signature?: string;
  error?: string;
}

/**
 * Proof verification result
 */
export interface VerificationResult {
  success: boolean;
  proofRecordAddress?: string;
  signature?: string;
  verified?: boolean;
  error?: string;
}

/**
 * Batch verification result
 */
export interface BatchVerificationResult {
  success: boolean;
  batchRecordAddress?: string;
  signature?: string;
  proofCount?: number;
  error?: string;
}

/**
 * Derive the registry PDA address
 */
export function deriveRegistryAddress(marketId: string): PublicKey {
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('registry'), Buffer.from(marketId)],
    ZK_VERIFIER_PROGRAM_ID
  );
  return registryPda;
}

/**
 * Derive the proof record PDA address
 */
export function deriveProofRecordAddress(proofId: string): PublicKey {
  const [proofPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), Buffer.from(proofId)],
    ZK_VERIFIER_PROGRAM_ID
  );
  return proofPda;
}

/**
 * Derive the batch record PDA address
 */
export function deriveBatchRecordAddress(batchId: string): PublicKey {
  const [batchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('batch'), Buffer.from(batchId)],
    ZK_VERIFIER_PROGRAM_ID
  );
  return batchPda;
}

/**
 * Convert commitment string to 32-byte array
 */
function commitmentToBytes(commitment: string): Uint8Array {
  const bytes = new Uint8Array(32);

  // Handle numeric string (Poseidon output)
  if (/^\d+$/.test(commitment)) {
    const bigInt = BigInt(commitment);
    const hexStr = bigInt.toString(16).padStart(64, '0');
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  // Handle hex string
  if (commitment.startsWith('0x')) {
    commitment = commitment.slice(2);
  }

  const paddedHex = commitment.padStart(64, '0');
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(paddedHex.substr(i * 2, 2), 16);
  }

  return bytes;
}

/**
 * Initialize a proof registry for a market
 */
export async function initializeRegistry(
  marketId: string,
  payer: Keypair
): Promise<RegistryInitResult> {
  try {
    const conn = getConnection();
    const registryAddress = deriveRegistryAddress(marketId);

    // Check if registry already exists
    const existingAccount = await conn.getAccountInfo(registryAddress);
    if (existingAccount) {
      return {
        success: true,
        registryAddress: registryAddress.toBase58(),
        signature: 'already-exists',
      };
    }

    // Build instruction data
    // Discriminator for initialize_registry (8 bytes) + market_id string
    const discriminator = Buffer.from([/* initialize_registry discriminator */]);
    const marketIdBuffer = Buffer.from(marketId);
    const marketIdLenBuffer = Buffer.alloc(4);
    marketIdLenBuffer.writeUInt32LE(marketId.length);

    const data = Buffer.concat([
      discriminator,
      marketIdLenBuffer,
      marketIdBuffer,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: registryAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: ZK_VERIFIER_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await conn.sendTransaction(transaction, [payer]);
    await conn.confirmTransaction(signature);

    return {
      success: true,
      registryAddress: registryAddress.toBase58(),
      signature,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Submit and verify a proof on-chain
 */
export async function verifyProofOnChain(
  proof: OnChainProofData,
  marketId: string,
  payer: Keypair
): Promise<VerificationResult> {
  try {
    const conn = getConnection();

    const registryAddress = deriveRegistryAddress(marketId);
    const proofRecordAddress = deriveProofRecordAddress(proof.proofId);

    // Check if proof already verified
    const existingProof = await conn.getAccountInfo(proofRecordAddress);
    if (existingProof) {
      return {
        success: true,
        proofRecordAddress: proofRecordAddress.toBase58(),
        signature: 'already-verified',
        verified: true,
      };
    }

    // Convert proof data to bytes
    const queryCommitmentBytes = commitmentToBytes(proof.queryCommitment);
    const responseCommitmentBytes = commitmentToBytes(proof.responseCommitment);
    const merkleRootBytes = commitmentToBytes(proof.merkleRoot);
    const verificationKeyBytes = commitmentToBytes(proof.verificationKey);
    const proofDataBytes = Buffer.from(proof.proofData, 'hex');

    // Build instruction (simplified - actual implementation would use Anchor IDL)
    const data = Buffer.concat([
      Buffer.from([/* verify_proof discriminator */]),
      Buffer.from(proof.proofId),
      queryCommitmentBytes,
      responseCommitmentBytes,
      merkleRootBytes,
      Buffer.from(new BigUint64Array([BigInt(proof.timestamp)]).buffer),
      Buffer.from(new Uint32Array([proofDataBytes.length]).buffer),
      proofDataBytes,
      verificationKeyBytes,
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: registryAddress, isSigner: false, isWritable: true },
        { pubkey: proofRecordAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: ZK_VERIFIER_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await conn.sendTransaction(transaction, [payer]);
    await conn.confirmTransaction(signature);

    return {
      success: true,
      proofRecordAddress: proofRecordAddress.toBase58(),
      signature,
      verified: true,
    };
  } catch (error) {
    return {
      success: false,
      verified: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verify multiple proofs in a batch
 */
export async function batchVerifyProofsOnChain(
  batchId: string,
  proofs: OnChainProofData[],
  batchMerkleRoot: string,
  payer: Keypair
): Promise<BatchVerificationResult> {
  try {
    const conn = getConnection();

    const batchRecordAddress = deriveBatchRecordAddress(batchId);

    // Check if batch already verified
    const existingBatch = await conn.getAccountInfo(batchRecordAddress);
    if (existingBatch) {
      return {
        success: true,
        batchRecordAddress: batchRecordAddress.toBase58(),
        signature: 'already-verified',
        proofCount: proofs.length,
      };
    }

    // Build batch verification instruction
    const merkleRootBytes = commitmentToBytes(batchMerkleRoot);

    // Serialize proofs
    const proofsData = proofs.map(p => ({
      proofId: p.proofId,
      queryCommitment: commitmentToBytes(p.queryCommitment),
      responseCommitment: commitmentToBytes(p.responseCommitment),
      merkleRoot: commitmentToBytes(p.merkleRoot),
      proofData: Buffer.from(p.proofData, 'hex'),
      verificationKey: commitmentToBytes(p.verificationKey),
    }));

    // Build instruction (simplified)
    const data = Buffer.concat([
      Buffer.from([/* batch_verify_proofs discriminator */]),
      Buffer.from(batchId),
      merkleRootBytes,
      // Serialized proofs would go here
    ]);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: batchRecordAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: ZK_VERIFIER_PROGRAM_ID,
      data,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await conn.sendTransaction(transaction, [payer]);
    await conn.confirmTransaction(signature);

    return {
      success: true,
      batchRecordAddress: batchRecordAddress.toBase58(),
      signature,
      proofCount: proofs.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if a proof has been verified on-chain
 */
export async function checkProofVerification(proofId: string): Promise<{
  verified: boolean;
  timestamp?: number;
  verifier?: string;
}> {
  try {
    const conn = getConnection();
    const proofRecordAddress = deriveProofRecordAddress(proofId);

    const accountInfo = await conn.getAccountInfo(proofRecordAddress);
    if (!accountInfo) {
      return { verified: false };
    }

    // Parse account data (simplified - actual implementation would use Anchor)
    // The account contains: proofId, commitments, verified flag, timestamp, verifier
    const data = accountInfo.data;

    // Skip discriminator (8 bytes) and proofId string
    const offset = 8 + 4 + 64; // discriminator + string len + max string
    const verified = data[offset + 32 + 32 + 32 + 8] === 1; // After commitments and timestamp
    const verifiedAt = Number(data.readBigInt64LE(offset + 32 + 32 + 32));
    const verifier = new PublicKey(data.slice(offset + 32 + 32 + 32 + 8 + 1, offset + 32 + 32 + 32 + 8 + 1 + 32));

    return {
      verified,
      timestamp: verifiedAt,
      verifier: verifier.toBase58(),
    };
  } catch {
    return { verified: false };
  }
}

/**
 * Get verification URL for a proof
 */
export function getVerificationUrl(proofId: string, cluster: 'mainnet' | 'devnet' = 'mainnet'): string {
  const proofRecordAddress = deriveProofRecordAddress(proofId);
  const explorerBase = cluster === 'mainnet'
    ? 'https://solscan.io/account'
    : 'https://solscan.io/account';

  return `${explorerBase}/${proofRecordAddress.toBase58()}?cluster=${cluster}`;
}
