/**
 * Encrypted Calls List Component
 *
 * Displays all encrypted predictions (calls) with on-chain verification.
 * Features:
 * - View all calls with encryption status
 * - See on-chain transaction proofs
 * - Pay to reveal predictions (REAL SOL payment required)
 * - Filter by status (encrypted/revealed)
 */

import { useState, useEffect } from 'react';
import { usePhantom } from '@phantom/react-sdk';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  listCalls,
  getCallsStatus,
  getPaymentInfo,
  revealCall,
  formatTimeAgo,
  truncateAddress,
  type EncryptedCall,
  type CallsStatus,
} from '../../lib/calls-api';

// Solana connection for transactions (mainnet for real payments)
// Use Helius RPC which supports CORS from browser
const SOLANA_RPC = import.meta.env.VITE_SOLANA_RPC || 'https://mainnet.helius-rpc.com/?api-key=36f73cf0-b00e-41ea-b16e-3f00b44aafee';

interface CallsListProps {
  userWallet?: string;
}

export function CallsList({ userWallet }: CallsListProps) {
  const { sdk } = usePhantom();
  const [calls, setCalls] = useState<EncryptedCall[]>([]);
  const [status, setStatus] = useState<CallsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'encrypted' | 'revealed'>('all');
  const [selectedCall, setSelectedCall] = useState<EncryptedCall | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealStep, setRevealStep] = useState<'idle' | 'fetching' | 'paying' | 'confirming' | 'revealing'>('idle');
  const [revealResult, setRevealResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchData();
  }, [filter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [callsRes, statusRes] = await Promise.all([
        listCalls({ status: filter, limit: 50 }),
        getCallsStatus(),
      ]);

      if (callsRes.success && callsRes.data) {
        setCalls(callsRes.data.calls);
      }
      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data);
      }
    } catch (error) {
      console.error('Failed to fetch calls:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReveal = async (call: EncryptedCall) => {
    if (!userWallet) {
      setRevealResult({ success: false, message: 'Connect wallet to reveal' });
      return;
    }

    if (!sdk) {
      setRevealResult({ success: false, message: 'Phantom wallet not available' });
      return;
    }

    setRevealing(true);
    setRevealResult(null);
    setSelectedCall(call);

    try {
      // Step 1: Get payment info
      setRevealStep('fetching');
      const paymentRes = await getPaymentInfo(call.id);

      if (!paymentRes.success || !paymentRes.data) {
        throw new Error(paymentRes.error || 'Failed to get payment info');
      }

      const { paymentAddress, requiredAmount } = paymentRes.data;

      // Step 2: Create and send SOL payment transaction
      setRevealStep('paying');
      const connection = new Connection(SOLANA_RPC, 'confirmed');

      const fromPubkey = new PublicKey(userWallet);
      const toPubkey = new PublicKey(paymentAddress);

      // Ensure requiredAmount is a valid number
      const lamportsToSend = Number(requiredAmount);
      console.log('Payment details:', {
        from: fromPubkey.toBase58(),
        to: toPubkey.toBase58(),
        lamports: lamportsToSend,
        sol: lamportsToSend / LAMPORTS_PER_SOL,
      });

      // Get latest blockhash first
      const { blockhash } = await connection.getLatestBlockhash('confirmed');

      // Create transfer instruction
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: fromPubkey,
      }).add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: lamportsToSend,
        })
      );

      // Use native Phantom provider for better compatibility
      const provider = (window as any).phantom?.solana;
      if (!provider) {
        throw new Error('Phantom wallet not found. Please install Phantom extension.');
      }

      // Ensure provider is connected
      if (!provider.isConnected) {
        await provider.connect();
      }

      // Sign and send via native Phantom provider
      const txResult = await provider.signAndSendTransaction(transaction);

      // Handle different return formats from Phantom
      let signature: string;
      if (typeof txResult === 'string') {
        signature = txResult;
      } else if (txResult.signature) {
        signature = typeof txResult.signature === 'string'
          ? txResult.signature
          : Buffer.from(txResult.signature).toString('base64');
      } else {
        throw new Error('Invalid signature response from wallet');
      }

      console.log('Payment TX sent:', signature);

      // Step 3: Wait for confirmation with retry logic
      setRevealStep('confirming');
      let confirmed = false;
      let retries = 0;
      const maxRetries = 10;

      while (!confirmed && retries < maxRetries) {
        try {
          const status = await connection.getSignatureStatus(signature);
          if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
            confirmed = true;
            console.log('Payment confirmed:', signature);
          } else if (status.value?.err) {
            throw new Error('Transaction failed on-chain');
          } else {
            // Wait 2 seconds before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            retries++;
          }
        } catch (e) {
          // On error, wait and retry
          await new Promise(resolve => setTimeout(resolve, 2000));
          retries++;
        }
      }

      if (!confirmed) {
        // Even if not confirmed locally, try the backend - it will verify on-chain
        console.log('Local confirmation timed out, letting backend verify...');
      }

      // Step 4: Submit to reveal endpoint - backend will verify on-chain
      setRevealStep('revealing');
      const result = await revealCall(call.id, userWallet, signature);

      if (result.success && result.data) {
        setRevealResult({
          success: true,
          message: `Revealed: "${result.data.revealedPrediction}"`,
        });
        // Refresh the list
        fetchData();
      } else {
        // If verification failed, the transaction may not have landed yet
        // Provide helpful error message with explorer link (mainnet)
        const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
        setRevealResult({
          success: false,
          message: `${result.error || 'Verification failed'}. Check transaction: ${explorerUrl}`,
        });
      }
    } catch (error: any) {
      console.error('Reveal error:', error);
      setRevealResult({
        success: false,
        message: error.message || 'Failed to process payment',
      });
    } finally {
      setRevealing(false);
      setRevealStep('idle');
      setSelectedCall(null);
    }
  };

  const getRevealStepText = () => {
    switch (revealStep) {
      case 'fetching': return 'Getting payment info...';
      case 'paying': return 'Sending SOL payment...';
      case 'confirming': return 'Confirming transaction...';
      case 'revealing': return 'Revealing prediction...';
      default: return 'Processing...';
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-8">
        <div className="flex items-center justify-center gap-3">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span className="text-gray-400">Loading calls...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      {status && (
        <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-lg border border-purple-500/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-white">Encrypted Calls</h3>
                <p className="text-sm text-gray-400">
                  {status.onChain ? 'On-chain via Light Protocol' : 'Off-chain'} | {status.encryption}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <span className="block text-2xl font-bold text-white">{status.totalCalls}</span>
                <span className="text-gray-500">Total Calls</span>
              </div>
              <div className="text-center">
                <span className="block text-2xl font-bold text-purple-400">{status.encryptedCalls}</span>
                <span className="text-gray-500">Encrypted</span>
              </div>
              <div className="text-center">
                <span className="block text-2xl font-bold text-green-400">{status.revealedCalls}</span>
                <span className="text-gray-500">Revealed</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Calls List */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">All Predictions</h2>
          <div className="flex items-center gap-2">
            {(['all', 'encrypted', 'revealed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  filter === f
                    ? 'bg-white text-gray-900'
                    : 'text-gray-400 hover:text-white bg-gray-800'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Calls */}
        {calls.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <p className="text-gray-400">No predictions yet</p>
            <p className="text-sm text-gray-500 mt-1">Make a call on any market to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {calls.map((call) => (
              <div
                key={call.id}
                className="p-4 hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Market & Status */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
                        {call.marketId}
                      </span>
                      {call.status === 'encrypted' ? (
                        <span className="flex items-center gap-1 text-xs bg-purple-900/50 text-purple-400 px-2 py-1 rounded">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                          Encrypted
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs bg-green-900/50 text-green-400 px-2 py-1 rounded">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Revealed
                        </span>
                      )}
                      {call.onChain?.verified && (
                        <a
                          href={call.onChain.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs bg-blue-900/50 text-blue-400 px-2 py-1 rounded hover:bg-blue-900/70"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          On-Chain
                        </a>
                      )}
                    </div>

                    {/* Prediction Content */}
                    <div className="mb-2">
                      {call.status === 'revealed' && call.revealedPrediction ? (
                        <p className="text-white">{call.revealedPrediction}</p>
                      ) : (
                        <p className="text-gray-500 italic flex items-center gap-2">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                          Prediction encrypted - pay {call.revealPriceSOL} to reveal
                        </p>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>By {truncateAddress(call.userWallet)}</span>
                      <span>{formatTimeAgo(call.timestamp)}</span>
                      <span className="font-mono">Hash: {call.predictionHash?.substring(0, 12)}...</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {call.status === 'encrypted' && call.revealCondition !== 'market_resolution' && (
                    <button
                      onClick={() => handleReveal(call)}
                      disabled={revealing}
                      className="ml-4 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      {revealing && selectedCall?.id === call.id ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          {getRevealStepText()}
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Pay {call.revealPriceSOL} to Reveal
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reveal Result Toast */}
      {revealResult && (
        <div className={`fixed bottom-4 right-4 max-w-md p-4 rounded-lg shadow-lg ${
          revealResult.success
            ? 'bg-green-900 border border-green-700'
            : 'bg-red-900 border border-red-700'
        }`}>
          <div className="flex items-start gap-3">
            {revealResult.success ? (
              <svg className="w-5 h-5 text-green-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-red-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            )}
            <div>
              <p className={`text-sm font-medium ${revealResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {revealResult.success ? 'Prediction Revealed!' : 'Reveal Failed'}
              </p>
              <p className="text-sm text-gray-300 mt-1">{revealResult.message}</p>
            </div>
            <button
              onClick={() => setRevealResult(null)}
              className="text-gray-400 hover:text-white"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
