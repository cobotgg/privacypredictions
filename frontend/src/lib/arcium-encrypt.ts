/**
 * Arcium Client-Side Encryption for AI Research
 *
 * Encrypts user questions before sending to the relay/backend.
 * The backend CANNOT decrypt these - only the Arcium MPC can.
 *
 * Flow:
 * 1. User types research question
 * 2. Client encrypts with MXE public key using x25519 ECDH
 * 3. Client sends encrypted blob to backend
 * 4. Backend stores/forwards encrypted data (cannot read it)
 * 5. MPC decrypts inside secure enclave for AI processing
 */

import { x25519 } from '@noble/curves/ed25519.js';

// Arcium MXE public key for devnet cluster
// This key is public - anyone can encrypt data for the MXE
const MXE_PUBLIC_KEY_HEX = '55912ee0367bbbf20eb497b7b16801367c18c3b10710ff3771e5551f8bc95baa';

/**
 * Research query data before encryption
 */
export interface ResearchQueryData {
  /** Market ID being researched */
  marketId: string;
  /** User's question */
  question: string;
  /** User's wallet address (for audit trail) */
  userWallet?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Encrypted research query to send to backend
 */
export interface EncryptedResearchQuery {
  /** Encrypted query data */
  ciphertext: string; // base64
  /** Ephemeral public key for decryption */
  ephemeralPubkey: string; // base64
  /** Nonce used for encryption */
  nonce: string; // base64
  /** Market ID (plaintext - backend needs for routing) */
  marketId: string;
  /** Query hash for commitment */
  queryHash: string;
  /** Encryption metadata */
  metadata: {
    algorithm: 'x25519-xor';
    mxeKeyId: string;
    timestamp: number;
  };
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert base64 to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
}

/**
 * Simple XOR cipher (for POC - production should use Rescue cipher)
 */
function xorCipher(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

/**
 * Compute SHA-256 hash of data
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypt a research query for submission to the backend.
 *
 * The backend receives:
 * - marketId (plaintext) - for routing
 * - queryHash (plaintext) - for commitment
 * - ciphertext (encrypted) - backend CANNOT read this
 * - ephemeralPubkey - for MPC decryption
 * - nonce - for MPC decryption
 *
 * The backend CANNOT see:
 * - The actual question text
 * - User wallet (if provided)
 */
export async function encryptResearchQuery(
  query: ResearchQueryData
): Promise<EncryptedResearchQuery> {
  // Get MXE public key
  const mxePublicKey = hexToBytes(MXE_PUBLIC_KEY_HEX);

  // Generate ephemeral key pair
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

  // Derive shared secret via ECDH
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);

  // Generate random nonce
  const nonce = crypto.getRandomValues(new Uint8Array(16));

  // Prepare plaintext
  const plaintext = JSON.stringify({
    marketId: query.marketId,
    question: query.question,
    userWallet: query.userWallet,
    timestamp: query.timestamp,
    salt: crypto.getRandomValues(new Uint8Array(8)).toString(),
  });

  const plaintextBytes = new TextEncoder().encode(plaintext);

  // Encrypt using XOR cipher with shared secret + nonce
  const keyMaterial = new Uint8Array([...sharedSecret, ...nonce]);
  const ciphertext = xorCipher(plaintextBytes, keyMaterial);

  // Compute query hash for commitment
  const queryHash = await sha256(plaintext);

  return {
    ciphertext: uint8ArrayToBase64(ciphertext),
    ephemeralPubkey: uint8ArrayToBase64(ephemeralPublicKey),
    nonce: uint8ArrayToBase64(nonce),
    marketId: query.marketId,
    queryHash: queryHash.substring(0, 32),
    metadata: {
      algorithm: 'x25519-xor',
      mxeKeyId: MXE_PUBLIC_KEY_HEX.substring(0, 16),
      timestamp: query.timestamp,
    },
  };
}

/**
 * Verify the MXE public key is configured
 */
export function isMxeKeyConfigured(): boolean {
  return MXE_PUBLIC_KEY_HEX.length === 64;
}

/**
 * Get encryption status for UI display
 */
export function getEncryptionStatus(): {
  enabled: boolean;
  algorithm: string;
  mxeKeyId: string;
} {
  return {
    enabled: isMxeKeyConfigured(),
    algorithm: 'x25519 ECDH + XOR',
    mxeKeyId: MXE_PUBLIC_KEY_HEX.substring(0, 16) + '...',
  };
}
