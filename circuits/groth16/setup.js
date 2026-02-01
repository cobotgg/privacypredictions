/**
 * Complete Groth16 Setup Script
 *
 * This script:
 * 1. Compiles the circom circuit
 * 2. Downloads/uses Powers of Tau ceremony file
 * 3. Generates proving and verification keys
 * 4. Exports Solana-compatible verification key
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');

const BUILD_DIR = path.join(__dirname, 'build');
const CIRCUIT_NAME = 'ai_response_verifier';

async function main() {
  console.log('='.repeat(60));
  console.log('  GROTH16 CIRCUIT SETUP');
  console.log('='.repeat(60));
  console.log('');

  // Create build directory
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  // Step 1: Compile circuit
  console.log('[1/5] Compiling circom circuit...');
  try {
    execSync(`circom ${CIRCUIT_NAME}.circom --r1cs --wasm --sym -o build`, {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Failed to compile circuit. Make sure circom is installed:');
    console.error('  curl -Ls https://github.com/iden3/circom/releases/download/v2.1.8/circom-macos-amd64 -o /usr/local/bin/circom && chmod +x /usr/local/bin/circom');
    process.exit(1);
  }

  // Step 2: Download Powers of Tau (if not exists)
  const ptauPath = path.join(BUILD_DIR, 'pot15_final.ptau');
  if (!fs.existsSync(ptauPath)) {
    console.log('[2/5] Downloading Powers of Tau ceremony file...');
    console.log('      (This is a one-time download, ~45MB)');
    try {
      execSync(
        `curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau -o ${ptauPath}`,
        { stdio: 'inherit' }
      );
    } catch (error) {
      console.error('Failed to download ptau file');
      process.exit(1);
    }
  } else {
    console.log('[2/5] Powers of Tau file already exists');
  }

  // Step 3: Generate zkey (circuit-specific proving key)
  console.log('[3/5] Generating proving key (zkey)...');
  const r1csPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`);
  const zkeyPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.zkey`);
  const zkeyFinalPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}_final.zkey`);

  await snarkjs.zKey.newZKey(r1csPath, ptauPath, zkeyPath);

  // Step 4: Contribute to ceremony (add randomness)
  console.log('[4/5] Contributing randomness to ceremony...');
  await snarkjs.zKey.contribute(
    zkeyPath,
    zkeyFinalPath,
    'AI Response Verifier Contribution',
    crypto.randomBytes(32).toString('hex')
  );

  // Clean up intermediate zkey
  fs.unlinkSync(zkeyPath);

  // Step 5: Export verification key
  console.log('[5/5] Exporting verification key...');
  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyFinalPath);
  const vkeyPath = path.join(BUILD_DIR, 'verification_key.json');
  fs.writeFileSync(vkeyPath, JSON.stringify(vkey, null, 2));

  // Export Solana-compatible verification key
  const solanaVkey = exportSolanaVerificationKey(vkey);
  const solanaVkeyPath = path.join(BUILD_DIR, 'verification_key_solana.json');
  fs.writeFileSync(solanaVkeyPath, JSON.stringify(solanaVkey, null, 2));

  console.log('');
  console.log('='.repeat(60));
  console.log('  SETUP COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('Generated files:');
  console.log(`  - ${r1csPath}`);
  console.log(`  - ${path.join(BUILD_DIR, `${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm`)}`);
  console.log(`  - ${zkeyFinalPath}`);
  console.log(`  - ${vkeyPath}`);
  console.log(`  - ${solanaVkeyPath}`);
  console.log('');
}

/**
 * Export verification key in Solana-compatible format
 * Converts the BN254 curve points to bytes for on-chain verification
 */
function exportSolanaVerificationKey(vkey) {
  // Convert G1 points (alpha, beta, gamma, delta)
  const alpha1 = g1ToBytes(vkey.vk_alpha_1);
  const beta2 = g2ToBytes(vkey.vk_beta_2);
  const gamma2 = g2ToBytes(vkey.vk_gamma_2);
  const delta2 = g2ToBytes(vkey.vk_delta_2);

  // Convert IC points (public inputs verification)
  const ic = vkey.IC.map(g1ToBytes);

  return {
    alpha1,
    beta2,
    gamma2,
    delta2,
    ic,
    // Hex encoded for easy copy-paste
    alpha1_hex: Buffer.from(alpha1).toString('hex'),
    beta2_hex: Buffer.from(beta2).toString('hex'),
    gamma2_hex: Buffer.from(gamma2).toString('hex'),
    delta2_hex: Buffer.from(delta2).toString('hex'),
    ic_hex: ic.map(p => Buffer.from(p).toString('hex')),
  };
}

/**
 * Convert G1 point to bytes (64 bytes: 32 for x, 32 for y)
 */
function g1ToBytes(point) {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  const bytes = new Uint8Array(64);

  // X coordinate (32 bytes, big-endian)
  const xHex = x.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(xHex.substr(i * 2, 2), 16);
  }

  // Y coordinate (32 bytes, big-endian)
  const yHex = y.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i++) {
    bytes[32 + i] = parseInt(yHex.substr(i * 2, 2), 16);
  }

  return Array.from(bytes);
}

/**
 * Convert G2 point to bytes (128 bytes)
 */
function g2ToBytes(point) {
  const bytes = new Uint8Array(128);
  let offset = 0;

  // G2 points have two components, each with x and y
  for (const coord of point) {
    if (Array.isArray(coord)) {
      for (const val of coord) {
        const bigInt = BigInt(val);
        const hex = bigInt.toString(16).padStart(64, '0');
        for (let i = 0; i < 32; i++) {
          bytes[offset + i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        offset += 32;
      }
    }
  }

  return Array.from(bytes);
}

const crypto = require('crypto');
main().catch(console.error);
