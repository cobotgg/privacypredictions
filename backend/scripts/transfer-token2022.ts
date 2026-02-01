/**
 * Transfer Token-2022 tokens to another wallet
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';
import { Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

const RPC_URL = process.env.SOLANA_RPC_URL!;
const MAIN_WALLET_KEY = process.env.MAIN_WALLET_PRIVATE_KEY!;

// Token and wallets
const TOKEN_MINT = new PublicKey('GPXAZGVqVGiyHuTEFw7T7dg4FW5aeWsmWcyPFndgSTZ');
const DESTINATION_WALLET = new PublicKey('CUck2d5ja2gRy96RrqDtUjdPS4BhdRZywQGaQbb4PUPj');

async function main() {
  console.log('Connecting to Solana...');
  const connection = new Connection(RPC_URL, 'confirmed');

  // Load main wallet
  const mainWallet = Keypair.fromSecretKey(bs58.decode(MAIN_WALLET_KEY));
  console.log('Source wallet:', mainWallet.publicKey.toBase58());
  console.log('Destination wallet:', DESTINATION_WALLET.toBase58());
  console.log('Token mint:', TOKEN_MINT.toBase58());

  // Get source token account (Token-2022)
  const sourceAta = getAssociatedTokenAddressSync(
    TOKEN_MINT,
    mainWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log('Source ATA:', sourceAta.toBase58());

  // Check source balance
  try {
    const sourceAccount = await getAccount(connection, sourceAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log('Source balance:', Number(sourceAccount.amount) / 1_000_000, 'tokens');

    if (sourceAccount.amount === BigInt(0)) {
      console.log('No tokens to transfer');
      return;
    }

    // Get or create destination ATA (allow PDA owners)
    const destAta = getAssociatedTokenAddressSync(
      TOKEN_MINT,
      DESTINATION_WALLET,
      true,  // allowOwnerOffCurve - destination might be a PDA
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    console.log('Destination ATA:', destAta.toBase58());

    const transaction = new Transaction();

    // Check if destination ATA exists
    try {
      await getAccount(connection, destAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
      console.log('Destination ATA exists');
    } catch {
      console.log('Creating destination ATA...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          mainWallet.publicKey,  // payer
          destAta,               // ata
          DESTINATION_WALLET,    // owner
          TOKEN_MINT,            // mint
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    // Add transfer instruction
    const amount = sourceAccount.amount;
    console.log(`Transferring ${Number(amount) / 1_000_000} tokens...`);

    transaction.add(
      createTransferInstruction(
        sourceAta,
        destAta,
        mainWallet.publicKey,
        amount,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    // Send transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = mainWallet.publicKey;

    console.log('Sending transaction...');
    const signature = await sendAndConfirmTransaction(connection, transaction, [mainWallet], {
      commitment: 'confirmed',
    });

    console.log('✓ Transfer successful!');
    console.log('Signature:', signature);
    console.log(`View on Solscan: https://solscan.io/tx/${signature}`);

  } catch (error: any) {
    console.error('Error:', error.message || error);
    console.error('Full error:', JSON.stringify(error, null, 2));
    if (error.logs) {
      console.error('Logs:', error.logs);
    }
  }
}

main().catch(console.error);
