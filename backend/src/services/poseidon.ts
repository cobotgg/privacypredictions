/**
 * Poseidon Hash utilities for ZK proof generation
 *
 * Provides field element conversions and Poseidon hash functions
 * for use in Noir circuits.
 */

import crypto from 'crypto';

/**
 * Convert a string to a field element (for Noir circuit compatibility)
 * Uses SHA256 and truncates to fit in BN254 field
 */
export function stringToField(str: string): string {
  const hash = crypto.createHash('sha256').update(str).digest('hex');
  // BN254 field is ~254 bits, so use first 62 hex chars (248 bits)
  return BigInt('0x' + hash.substring(0, 62)).toString();
}

/**
 * Convert a timestamp to a field element
 */
export function timestampToField(timestamp: number | Date): string {
  const ts = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  return ts.toString();
}

/**
 * Poseidon hash of 2 field elements (simulated)
 * In production, use actual Poseidon implementation from circomlibjs
 */
export async function poseidonHash2(a: string, b: string): Promise<string> {
  const combined = `${a}:${b}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return BigInt('0x' + hash.substring(0, 62)).toString();
}

/**
 * Poseidon hash of 3 field elements (simulated)
 * Accepts either 3 separate arguments or an array of 3 elements
 */
export async function poseidonHash3(inputs: string[]): Promise<string>;
export async function poseidonHash3(a: string, b: string, c: string): Promise<string>;
export async function poseidonHash3(aOrInputs: string | string[], b?: string, c?: string): Promise<string> {
  const combined = Array.isArray(aOrInputs)
    ? aOrInputs.join(':')
    : `${aOrInputs}:${b}:${c}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return BigInt('0x' + hash.substring(0, 62)).toString();
}

/**
 * Poseidon hash of 5 field elements (simulated)
 */
export async function poseidonHash5(inputs: string[]): Promise<string> {
  const combined = inputs.join(':');
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  return BigInt('0x' + hash.substring(0, 62)).toString();
}
