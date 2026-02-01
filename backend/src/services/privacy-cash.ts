import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivacyCash } from 'privacycash';
import { config } from '../config/env.js';
import { getWalletKeypairByAddress, getMainWalletKeypair } from './wallet.js';

// Cache Privacy Cash instances per wallet
const privacyCashInstances: Map<string, PrivacyCash> = new Map();

/**
 * Get or create a Privacy Cash instance for a wallet
 */
function getPrivacyCashInstance(keypair: Keypair): PrivacyCash {
  const address = keypair.publicKey.toBase58();

  if (!privacyCashInstances.has(address)) {
    const instance = new PrivacyCash({
      RPC_url: config.solanaRpcUrl,
      owner: keypair,
      enableDebug: config.nodeEnv === 'development',
    });
    privacyCashInstances.set(address, instance);
  }

  return privacyCashInstances.get(address)!;
}

export interface PrivacyCashTransferParams {
  sender: string;
  recipient: string;
  amount: number;
  token: 'SOL' | 'USDC';
}

export interface PrivacyCashTransferResult {
  success: boolean;
  depositTx?: string;
  withdrawTx?: string;
  fee: number;
  netAmount: number;
  error?: string;
  provider: 'privacy-cash';
}

export interface PrivacyCashBalanceInfo {
  wallet: string;
  privateBalance: number;
  token: string;
  provider: 'privacy-cash';
}

/**
 * Execute a private transfer using Privacy Cash
 *
 * Flow:
 * 1. Sender deposits to Privacy Cash pool
 * 2. Withdraw from pool to recipient address
 *
 * Result: No on-chain link between sender and recipient
 */
export async function executePrivacyCashTransfer(
  params: PrivacyCashTransferParams
): Promise<PrivacyCashTransferResult> {
  const { sender, recipient, amount, token } = params;

  // Privacy Cash fee is ~1%
  const feePercentage = 0.01;
  const fee = amount * feePercentage;
  const netAmount = amount - fee;

  try {
    // Get sender keypair
    const senderKeypair = getWalletKeypairByAddress(sender);
    if (!senderKeypair) {
      return {
        success: false,
        fee,
        netAmount,
        error: 'Sender wallet not found or not controlled by this backend',
        provider: 'privacy-cash',
      };
    }

    // Get Privacy Cash instance for sender
    const privacyCash = getPrivacyCashInstance(senderKeypair);

    console.log(`[PrivacyCash] Starting transfer: ${amount} ${token}`);
    console.log(`[PrivacyCash] From: ${sender} To: ${recipient}`);

    // Step 1: Deposit to Privacy Cash pool
    console.log(`[PrivacyCash] Step 1: Depositing to privacy pool...`);
    let depositResult: { tx: string };

    if (token === 'SOL') {
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      depositResult = await privacyCash.deposit({ lamports });
    } else {
      // USDC has 6 decimals
      const baseUnits = Math.floor(amount * 1_000_000);
      depositResult = await privacyCash.depositUSDC({ base_units: baseUnits });
    }

    console.log(`[PrivacyCash] Deposit tx: ${depositResult.tx}`);

    // Step 2: Withdraw to recipient
    console.log(`[PrivacyCash] Step 2: Withdrawing to recipient...`);
    let withdrawResult: { tx: string; isPartial: boolean; recipient: string };

    if (token === 'SOL') {
      const lamports = Math.floor(netAmount * LAMPORTS_PER_SOL);
      withdrawResult = await privacyCash.withdraw({
        lamports,
        recipientAddress: recipient,
      });
    } else {
      const baseUnits = Math.floor(netAmount * 1_000_000);
      withdrawResult = await privacyCash.withdrawUSDC({
        base_units: baseUnits,
        recipientAddress: recipient,
      });
    }

    console.log(`[PrivacyCash] Withdraw tx: ${withdrawResult.tx}`);
    console.log(`[PrivacyCash] Transfer complete!`);

    return {
      success: true,
      depositTx: depositResult.tx,
      withdrawTx: withdrawResult.tx,
      fee,
      netAmount,
      provider: 'privacy-cash',
    };
  } catch (error) {
    console.error('[PrivacyCash] Transfer error:', error);
    return {
      success: false,
      fee,
      netAmount,
      error: error instanceof Error ? error.message : 'Transfer failed',
      provider: 'privacy-cash',
    };
  }
}

/**
 * Get private balance in Privacy Cash pool
 */
export async function getPrivacyCashBalance(
  wallet: string,
  token: 'SOL' | 'USDC' = 'SOL'
): Promise<PrivacyCashBalanceInfo> {
  const keypair = getWalletKeypairByAddress(wallet);
  if (!keypair) {
    return {
      wallet,
      privateBalance: 0,
      token,
      provider: 'privacy-cash',
    };
  }

  const privacyCash = getPrivacyCashInstance(keypair);

  try {
    if (token === 'SOL') {
      const balance = await privacyCash.getPrivateBalance();
      return {
        wallet,
        privateBalance: balance.lamports / LAMPORTS_PER_SOL,
        token: 'SOL',
        provider: 'privacy-cash',
      };
    } else {
      const balance = await privacyCash.getPrivateBalanceUSDC();
      return {
        wallet,
        privateBalance: balance.amount,
        token: 'USDC',
        provider: 'privacy-cash',
      };
    }
  } catch (error) {
    console.error('[PrivacyCash] Balance check error:', error);
    return {
      wallet,
      privateBalance: 0,
      token,
      provider: 'privacy-cash',
    };
  }
}

/**
 * Deposit directly to Privacy Cash pool (for pre-funding)
 */
export async function depositToPrivacyCash(
  wallet: string,
  amount: number,
  token: 'SOL' | 'USDC' = 'SOL'
): Promise<{ success: boolean; tx?: string; error?: string }> {
  const keypair = getWalletKeypairByAddress(wallet);
  if (!keypair) {
    return { success: false, error: 'Wallet not found' };
  }

  const privacyCash = getPrivacyCashInstance(keypair);

  try {
    let result: { tx: string };

    if (token === 'SOL') {
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      result = await privacyCash.deposit({ lamports });
    } else {
      const baseUnits = Math.floor(amount * 1_000_000);
      result = await privacyCash.depositUSDC({ base_units: baseUnits });
    }

    return { success: true, tx: result.tx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Deposit failed',
    };
  }
}

/**
 * Withdraw from Privacy Cash pool
 */
export async function withdrawFromPrivacyCash(
  wallet: string,
  amount: number,
  recipientAddress: string,
  token: 'SOL' | 'USDC' = 'SOL'
): Promise<{ success: boolean; tx?: string; error?: string }> {
  const keypair = getWalletKeypairByAddress(wallet);
  if (!keypair) {
    return { success: false, error: 'Wallet not found' };
  }

  const privacyCash = getPrivacyCashInstance(keypair);

  try {
    let result: { tx: string; isPartial: boolean };

    if (token === 'SOL') {
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
      result = await privacyCash.withdraw({ lamports, recipientAddress });
    } else {
      const baseUnits = Math.floor(amount * 1_000_000);
      result = await privacyCash.withdrawUSDC({ base_units: baseUnits, recipientAddress });
    }

    return { success: true, tx: result.tx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Withdraw failed',
    };
  }
}

/**
 * Get fee information for Privacy Cash
 */
export function getPrivacyCashFeeInfo() {
  return {
    feePercentage: 1, // 1%
    minimumAmount: {
      SOL: 0.01,
      USDC: 1,
    },
    provider: 'privacy-cash',
  };
}

/**
 * Calculate fee breakdown for Privacy Cash
 */
export function calculatePrivacyCashFee(amount: number, token: 'SOL' | 'USDC' = 'SOL') {
  const feePercentage = 0.01; // 1%
  const fee = amount * feePercentage;
  const netAmount = amount - fee;

  return {
    amount,
    fee,
    feePercentage: feePercentage * 100,
    netAmount,
    token,
    provider: 'privacy-cash',
  };
}
