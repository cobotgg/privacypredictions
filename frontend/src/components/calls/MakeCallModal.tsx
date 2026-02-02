/**
 * Make Call Modal Component
 *
 * Allows users to make encrypted predictions on markets.
 * Features:
 * - Encrypt prediction with Inco TEE
 * - Store on-chain via Light Protocol
 * - Choose reveal conditions
 */

import { useState } from 'react';
import { createCall } from '../../lib/calls-api';

interface Market {
  id: string;
  ticker: string;
  title: string;
  yesPrice: number;
  noPrice: number;
}

interface MakeCallModalProps {
  market: Market;
  userWallet: string;
  onClose: () => void;
  onSuccess?: (callId: string) => void;
}

export function MakeCallModal({ market, userWallet, onClose, onSuccess }: MakeCallModalProps) {
  const [prediction, setPrediction] = useState('');
  const [revealCondition, setRevealCondition] = useState<'market_resolution' | 'payment' | 'both'>('both');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    callId?: string;
    txSignature?: string;
    explorerUrl?: string;
  } | null>(null);

  const handleSubmit = async () => {
    if (!prediction.trim()) return;

    setSubmitting(true);
    setResult(null);

    try {
      const response = await createCall(market.id, prediction.trim(), userWallet, revealCondition);

      if (response.success && response.data) {
        setResult({
          success: true,
          message: response.data.message,
          callId: response.data.callId,
          txSignature: response.data.onChain.txSignature,
          explorerUrl: response.data.onChain.explorerUrl,
        });
        onSuccess?.(response.data.callId);
      } else {
        setResult({
          success: false,
          message: response.error || 'Failed to create call',
        });
      }
    } catch (error: any) {
      setResult({
        success: false,
        message: error.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg shadow-lg max-w-lg w-full overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-white">Make a Call</h3>
                <p className="text-xs text-gray-400">Encrypted prediction stored on-chain</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* Market Info */}
          <div className="mb-4 p-3 bg-gray-800 rounded-lg">
            <span className="text-xs font-mono text-gray-500">{market.ticker}</span>
            <p className="text-sm font-medium text-white mt-1">{market.title}</p>
            <div className="flex items-center gap-4 mt-2 text-xs">
              <span className="text-green-400">YES {market.yesPrice}%</span>
              <span className="text-red-400">NO {market.noPrice}%</span>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="mb-4 p-3 bg-purple-900/30 border border-purple-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-purple-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-purple-300">End-to-End Encryption</p>
                <p className="text-xs text-gray-400 mt-1">
                  Your prediction is encrypted with Inco TEE and stored on Solana via Light Protocol.
                  Only a hash is visible until reveal.
                </p>
              </div>
            </div>
          </div>

          {result?.success ? (
            /* Success State */
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold text-white mb-2">Call Recorded On-Chain!</h4>
              <p className="text-sm text-gray-400 mb-4">{result.message}</p>

              {result.explorerUrl && (
                <a
                  href={result.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View on Solana Explorer
                </a>
              )}

              <div className="mt-4 p-3 bg-gray-800 rounded-lg text-left">
                <p className="text-xs text-gray-500 mb-1">Transaction Signature</p>
                <p className="text-xs font-mono text-gray-300 break-all">{result.txSignature}</p>
              </div>

              <button
                onClick={onClose}
                className="mt-6 px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            /* Input State */
            <>
              {/* Prediction Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Your Prediction
                </label>
                <textarea
                  value={prediction}
                  onChange={(e) => setPrediction(e.target.value)}
                  placeholder="e.g., I believe this market will resolve YES because..."
                  className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none"
                  rows={4}
                  maxLength={500}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-500">
                    {prediction.length}/500 characters
                  </span>
                </div>
              </div>

              {/* Reveal Condition */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Reveal Condition
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'both', label: 'Market Resolution OR Payment', desc: 'Reveals when market resolves or someone pays' },
                    { value: 'market_resolution', label: 'Market Resolution Only', desc: 'Only reveals when market resolves' },
                    { value: 'payment', label: 'Payment Only', desc: 'Only reveals when someone pays ~$0.10' },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        revealCondition === option.value
                          ? 'border-purple-500 bg-purple-900/20'
                          : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="revealCondition"
                        value={option.value}
                        checked={revealCondition === option.value}
                        onChange={(e) => setRevealCondition(e.target.value as typeof revealCondition)}
                        className="mt-1"
                      />
                      <div>
                        <span className="text-sm font-medium text-white">{option.label}</span>
                        <p className="text-xs text-gray-500 mt-0.5">{option.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Error Message */}
              {result && !result.success && (
                <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg">
                  <p className="text-sm text-red-400">{result.message}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 py-3 font-medium border border-gray-600 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !prediction.trim()}
                  className="flex-1 py-3 font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Encrypting & Storing...
                    </span>
                  ) : (
                    'Submit Call'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
