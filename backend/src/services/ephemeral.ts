import { Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { config } from '../config/env.js';
import { getConnection, getMainWalletKeypair } from './wallet.js';
import type { TransferResult } from '../types/index.js';

// Transfer SOL between wallets
export async function transferSol(
  fromKeypair: Keypair,
  toAddress: string,
  amount: number
): Promise<TransferResult> {
  const connection = getConnection();

  try {
    const lamports = Math.round(amount * LAMPORTS_PER_SOL);
    const toPubkey = new PublicKey(toAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromKeypair.publicKey;

    transaction.sign(fromKeypair);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');

    return { success: true, signature };
  } catch (error: any) {
    console.error('SOL transfer error:', error.message);
    return { success: false, error: error.message };
  }
}

// Transfer USDC between wallets
export async function transferUsdc(
  fromKeypair: Keypair,
  toAddress: string,
  amount: number
): Promise<TransferResult> {
  const connection = getConnection();

  try {
    const usdcMint = new PublicKey(config.usdcMint);
    const toPubkey = new PublicKey(toAddress);
    const amountMicro = Math.round(amount * 1_000_000);

    // Get source ATA
    const sourceAta = await getAssociatedTokenAddress(usdcMint, fromKeypair.publicKey);

    // Get destination ATA
    const destAta = await getAssociatedTokenAddress(usdcMint, toPubkey);

    const transaction = new Transaction();

    // Create destination ATA if needed
    try {
      await connection.getAccountInfo(destAta);
    } catch {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          fromKeypair.publicKey,
          destAta,
          toPubkey,
          usdcMint
        )
      );
    }

    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        sourceAta,
        destAta,
        fromKeypair.publicKey,
        amountMicro
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromKeypair.publicKey;

    transaction.sign(fromKeypair);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');

    return { success: true, signature };
  } catch (error: any) {
    console.error('USDC transfer error:', error.message);
    return { success: false, error: error.message };
  }
}

// Fund a trading wallet from main wallet
export async function fundTradingWallet(
  tradingWalletAddress: string,
  solAmount: number,
  usdcAmount: number
): Promise<{ solResult?: TransferResult; usdcResult?: TransferResult }> {
  const mainWallet = getMainWalletKeypair();
  const results: { solResult?: TransferResult; usdcResult?: TransferResult } = {};

  if (solAmount > 0) {
    results.solResult = await transferSol(mainWallet, tradingWalletAddress, solAmount);
  }

  if (usdcAmount > 0) {
    results.usdcResult = await transferUsdc(mainWallet, tradingWalletAddress, usdcAmount);
  }

  return results;
}

// Withdraw from trading wallet to main wallet
export async function withdrawFromTradingWallet(
  tradingWalletKeypair: Keypair,
  solAmount?: number,
  usdcAmount?: number
): Promise<{ solResult?: TransferResult; usdcResult?: TransferResult }> {
  const mainWalletAddress = getMainWalletKeypair().publicKey.toBase58();
  const results: { solResult?: TransferResult; usdcResult?: TransferResult } = {};

  if (solAmount && solAmount > 0) {
    results.solResult = await transferSol(tradingWalletKeypair, mainWalletAddress, solAmount);
  }

  if (usdcAmount && usdcAmount > 0) {
    results.usdcResult = await transferUsdc(tradingWalletKeypair, mainWalletAddress, usdcAmount);
  }

  return results;
}

// Withdraw ALL funds from a wallet to main wallet
export async function withdrawAllToMainWallet(
  fromKeypair: Keypair,
  toPublicKey: PublicKey
): Promise<{
  solWithdrawn: number;
  usdcWithdrawn: number;
  solSignature?: string;
  usdcSignature?: string;
  errors: string[];
}> {
  const connection = getConnection();
  const result = {
    solWithdrawn: 0,
    usdcWithdrawn: 0,
    solSignature: undefined as string | undefined,
    usdcSignature: undefined as string | undefined,
    errors: [] as string[],
  };

  try {
    // Get SOL balance
    const solBalance = await connection.getBalance(fromKeypair.publicKey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;

    // Get USDC balance
    let usdcAmount = 0;
    try {
      const usdcMint = new PublicKey(config.usdcMint);
      const ata = await getAssociatedTokenAddress(usdcMint, fromKeypair.publicKey);
      const accountInfo = await connection.getTokenAccountBalance(ata);
      usdcAmount = accountInfo.value.uiAmount || 0;
    } catch {
      // No USDC account
    }

    // Withdraw USDC first (if any)
    if (usdcAmount > 0) {
      try {
        const usdcMint = new PublicKey(config.usdcMint);
        const sourceAta = await getAssociatedTokenAddress(usdcMint, fromKeypair.publicKey);
        const destAta = await getAssociatedTokenAddress(usdcMint, toPublicKey);

        const transaction = new Transaction();

        // Check if destination ATA exists
        const destAccount = await connection.getAccountInfo(destAta);
        if (!destAccount) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              fromKeypair.publicKey,
              destAta,
              toPublicKey,
              usdcMint
            )
          );
        }

        // Get raw amount
        const accountInfo = await connection.getTokenAccountBalance(sourceAta);
        const rawAmount = BigInt(accountInfo.value.amount);

        transaction.add(
          createTransferInstruction(
            sourceAta,
            destAta,
            fromKeypair.publicKey,
            rawAmount
          )
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fromKeypair.publicKey;
        transaction.sign(fromKeypair);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        await connection.confirmTransaction(signature, 'confirmed');
        result.usdcWithdrawn = usdcAmount;
        result.usdcSignature = signature;
      } catch (e: any) {
        result.errors.push(`USDC withdraw failed: ${e.message}`);
      }
    }

    // Withdraw SOL (leave minimum for rent)
    const minRent = 0.001; // Keep minimum SOL for future operations
    const solToWithdraw = solAmount - minRent - 0.0005; // Subtract fee

    if (solToWithdraw > 0) {
      try {
        const lamports = Math.floor(solToWithdraw * LAMPORTS_PER_SOL);

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: fromKeypair.publicKey,
            toPubkey: toPublicKey,
            lamports,
          })
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fromKeypair.publicKey;
        transaction.sign(fromKeypair);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        await connection.confirmTransaction(signature, 'confirmed');
        result.solWithdrawn = solToWithdraw;
        result.solSignature = signature;
      } catch (e: any) {
        result.errors.push(`SOL withdraw failed: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(`Withdraw error: ${e.message}`);
  }

  return result;
}

// Withdraw to main wallet helper (for compatibility)
export async function withdrawToMainWallet(
  fromKeypair: Keypair,
  toPublicKey: PublicKey
): Promise<{
  solWithdrawn: number;
  usdcWithdrawn: number;
  errors: string[];
}> {
  return withdrawAllToMainWallet(fromKeypair, toPublicKey);
}
