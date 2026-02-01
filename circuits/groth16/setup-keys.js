/**
 * Groth16 Key Setup Script
 *
 * Generates proving and verification keys using Powers of Tau ceremony
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as snarkjs from 'snarkjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, 'build');
const CIRCUIT_NAME = 'ai_response_verifier';

async function main() {
  console.log('='.repeat(60));
  console.log('  GROTH16 KEY SETUP');
  console.log('='.repeat(60));
  console.log('');

  // Check for compiled circuit
  const r1csPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}.r1cs`);
  if (!fs.existsSync(r1csPath)) {
    console.error('Circuit not compiled. Run: circom ai_response_verifier.circom --r1cs --wasm --sym -o build');
    process.exit(1);
  }

  // Step 1: Download Powers of Tau (if not exists)
  const ptauPath = path.join(BUILD_DIR, 'pot15_final.ptau');
  if (!fs.existsSync(ptauPath)) {
    console.log('[1/4] Downloading Powers of Tau ceremony file...');
    console.log('      (This is a one-time download, ~45MB)');
    try {
      execSync(
        `curl -L https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau -o ${ptauPath}`,
        { stdio: 'inherit' }
      );
    } catch (error) {
      console.error('Failed to download ptau file');
      process.exit(1);
    }
  } else {
    console.log('[1/4] Powers of Tau file already exists');
  }

  // Step 2: Generate initial zkey
  console.log('[2/4] Generating initial zkey...');
  const zkeyInitPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}_0000.zkey`);
  const zkeyFinalPath = path.join(BUILD_DIR, `${CIRCUIT_NAME}_final.zkey`);

  await snarkjs.zKey.newZKey(r1csPath, ptauPath, zkeyInitPath);

  // Step 3: Contribute to ceremony
  console.log('[3/4] Contributing randomness to ceremony...');
  const entropy = crypto.randomBytes(32).toString('hex');
  await snarkjs.zKey.contribute(
    zkeyInitPath,
    zkeyFinalPath,
    'AI Response Verifier Contribution',
    entropy
  );

  // Clean up initial zkey
  fs.unlinkSync(zkeyInitPath);

  // Step 4: Export verification key
  console.log('[4/4] Exporting verification key...');
  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyFinalPath);
  const vkeyPath = path.join(BUILD_DIR, 'verification_key.json');
  fs.writeFileSync(vkeyPath, JSON.stringify(vkey, null, 2));

  // Export Solana-compatible verification key
  const solanaVkey = exportSolanaVerificationKey(vkey);
  const solanaVkeyPath = path.join(BUILD_DIR, 'verification_key_solana.json');
  fs.writeFileSync(solanaVkeyPath, JSON.stringify(solanaVkey, null, 2));

  // Export Rust constants for Solana program
  const rustConstantsPath = path.join(BUILD_DIR, 'vk_constants.rs');
  fs.writeFileSync(rustConstantsPath, exportRustConstants(solanaVkey));

  console.log('');
  console.log('='.repeat(60));
  console.log('  SETUP COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log('Generated files:');
  console.log(`  - ${zkeyFinalPath}`);
  console.log(`  - ${vkeyPath}`);
  console.log(`  - ${solanaVkeyPath}`);
  console.log(`  - ${rustConstantsPath}`);
  console.log('');
  console.log('Circuit stats:');

  // Print circuit info
  const circuitInfo = await snarkjs.r1cs.info(r1csPath);
  console.log('');
}

/**
 * Export verification key in Solana-compatible format
 */
function exportSolanaVerificationKey(vkey) {
  // Convert curve points to bytes
  const alpha1 = g1ToBytes(vkey.vk_alpha_1);
  const beta2 = g2ToBytes(vkey.vk_beta_2);
  const gamma2 = g2ToBytes(vkey.vk_gamma_2);
  const delta2 = g2ToBytes(vkey.vk_delta_2);
  const ic = vkey.IC.map(g1ToBytes);

  return {
    alpha1,
    beta2,
    gamma2,
    delta2,
    ic,
    nPublicInputs: vkey.IC.length - 1,
  };
}

/**
 * Convert G1 point [x, y, z] to 64 bytes (x and y coordinates, affine)
 */
function g1ToBytes(point) {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);

  const xBytes = bigIntToBytes32(x);
  const yBytes = bigIntToBytes32(y);

  return [...xBytes, ...yBytes];
}

/**
 * Convert G2 point to 128 bytes
 */
function g2ToBytes(point) {
  // G2 points: [[x0, x1], [y0, y1], [z0, z1]]
  const x = point[0];
  const y = point[1];

  const x0Bytes = bigIntToBytes32(BigInt(x[0]));
  const x1Bytes = bigIntToBytes32(BigInt(x[1]));
  const y0Bytes = bigIntToBytes32(BigInt(y[0]));
  const y1Bytes = bigIntToBytes32(BigInt(y[1]));

  return [...x0Bytes, ...x1Bytes, ...y0Bytes, ...y1Bytes];
}

/**
 * Convert BigInt to 32 bytes (big-endian)
 */
function bigIntToBytes32(val) {
  const hex = val.toString(16).padStart(64, '0');
  const bytes = [];
  for (let i = 0; i < 32; i++) {
    bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  }
  return bytes;
}

/**
 * Export Rust constants for Solana program
 */
function exportRustConstants(solanaVkey) {
  const formatBytes = (arr, name) => {
    const lines = [];
    for (let i = 0; i < arr.length; i += 16) {
      const slice = arr.slice(i, Math.min(i + 16, arr.length));
      lines.push('    ' + slice.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ') + ',');
    }
    return `pub const ${name}: [u8; ${arr.length}] = [\n${lines.join('\n')}\n];`;
  };

  let rust = `// Auto-generated Groth16 verification key constants
// Generated for AI Response Verifier circuit

`;

  rust += formatBytes(solanaVkey.alpha1, 'VK_ALPHA1') + '\n\n';
  rust += formatBytes(solanaVkey.beta2, 'VK_BETA2') + '\n\n';
  rust += formatBytes(solanaVkey.gamma2, 'VK_GAMMA2') + '\n\n';
  rust += formatBytes(solanaVkey.delta2, 'VK_DELTA2') + '\n\n';

  rust += `pub const VK_IC: [[u8; 64]; ${solanaVkey.ic.length}] = [\n`;
  for (const ic of solanaVkey.ic) {
    rust += '    [\n';
    for (let i = 0; i < ic.length; i += 16) {
      const slice = ic.slice(i, Math.min(i + 16, ic.length));
      rust += '        ' + slice.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ') + ',\n';
    }
    rust += '    ],\n';
  }
  rust += '];\n\n';

  rust += `pub const N_PUBLIC_INPUTS: usize = ${solanaVkey.nPublicInputs};\n`;

  return rust;
}

main().catch(console.error);
