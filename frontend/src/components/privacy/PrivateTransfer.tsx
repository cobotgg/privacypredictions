import { useState, useEffect } from 'react';
import { usePhantom, AddressType } from '@phantom/react-sdk';

interface ShadowWireStatus {
  enabled: boolean;
  supportedTokens: string[];
}

interface FeeBreakdown {
  amount: number;
  fee: number;
  feePercentage: number;
  netAmount: number;
  token: string;
}

interface TransferResult {
  success: boolean;
  txSignature?: string;
  transferType: 'internal' | 'external';
  fee: number;
  netAmount: number;
  error?: string;
}

type SupportedToken = 'SOL' | 'USDC' | 'RADR' | 'USD1';

export function PrivateTransfer() {
  const { addresses } = usePhantom();
  const solanaAddress = addresses.find(addr => addr.addressType === AddressType.solana)?.address;

  const [status, setStatus] = useState<ShadowWireStatus | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState<SupportedToken>('SOL');
  const [feeBreakdown, setFeeBreakdown] = useState<FeeBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch ShadowWire status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  // Calculate fees when amount or token changes
  useEffect(() => {
    const amt = parseFloat(amount);
    if (!isNaN(amt) && amt > 0) {
      calculateFees(amt, token);
    } else {
      setFeeBreakdown(null);
    }
  }, [amount, token]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/shadowwire/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch ShadowWire status:', err);
    }
  };

  const calculateFees = async (amt: number, tok: SupportedToken) => {
    try {
      const res = await fetch(`/api/shadowwire/fees/calculate?amount=${amt}&token=${tok}`);
      const data = await res.json();
      if (data.success) {
        setFeeBreakdown(data.data);
      }
    } catch (err) {
      console.error('Failed to calculate fees:', err);
    }
  };

  const executeTransfer = async () => {
    if (!solanaAddress || !recipient || !amount) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/shadowwire/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: solanaAddress,
          recipient,
          amount: parseFloat(amount),
          token,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResult(data.data);
        setRecipient('');
        setAmount('');
      } else {
        setError(data.error || 'Transfer failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  if (!status?.enabled) {
    return (
      <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Private Transfers</h2>
            <p className="text-sm text-gray-500">ShadowWire ZK-powered transfers</p>
          </div>
        </div>
        <p className="text-gray-500 text-sm">ShadowWire is not enabled. Contact admin to enable private transfers.</p>
      </div>
    );
  }

  // Show result after successful transfer
  if (result?.success) {
    return (
      <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Transfer Complete</h2>
            <p className="text-sm text-gray-500">
              {result.transferType === 'internal' ? 'Amount hidden with ZK proofs' : 'Anonymous sender transfer'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Transfer Type</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                result.transferType === 'internal'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {result.transferType.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Net Amount</span>
              <span className="text-white font-medium">{result.netAmount.toFixed(6)} {token}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Fee</span>
              <span className="text-gray-400">{result.fee.toFixed(6)} {token}</span>
            </div>
            {result.txSignature && (
              <div className="pt-2 border-t border-gray-700">
                <p className="text-gray-400 text-xs mb-1">Transaction</p>
                <a
                  href={`https://solscan.io/tx/${result.txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 text-xs hover:underline break-all"
                >
                  {result.txSignature.slice(0, 20)}...{result.txSignature.slice(-20)}
                </a>
              </div>
            )}
          </div>

          <button
            onClick={() => setResult(null)}
            className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors"
          >
            New Transfer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-white">Private Transfer</h2>
          <p className="text-sm text-gray-500">Send funds with ZK privacy</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Token Selector */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Token</label>
          <div className="flex gap-2">
            {(['SOL', 'USDC', 'USD1'] as const).map((tok) => (
              <button
                key={tok}
                onClick={() => setToken(tok)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  token === tok
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {tok}
              </button>
            ))}
          </div>
        </div>

        {/* Recipient Address */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Enter Solana address..."
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono text-sm"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Amount</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 pr-16 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              {token}
            </span>
          </div>
        </div>

        {/* Fee Breakdown */}
        {feeBreakdown && (
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Amount</span>
              <span className="text-white">{feeBreakdown.amount.toFixed(6)} {token}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Fee ({feeBreakdown.feePercentage.toFixed(1)}%)</span>
              <span className="text-gray-400">-{feeBreakdown.fee.toFixed(6)} {token}</span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between">
              <span className="text-white font-medium">Recipient Gets</span>
              <span className="text-white font-medium">{feeBreakdown.netAmount.toFixed(6)} {token}</span>
            </div>
          </div>
        )}

        {/* Privacy Info */}
        <div className="bg-purple-500/10 rounded-xl p-4">
          <p className="text-purple-400 text-sm">
            <span className="font-semibold">Privacy Mode:</span> If recipient is registered with ShadowWire,
            the transfer amount will be hidden using ZK proofs. Otherwise, an anonymous sender transfer
            will be executed.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={executeTransfer}
          disabled={loading || !recipient || !amount || !solanaAddress}
          className="w-full py-4 bg-purple-500 hover:bg-purple-400 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing...' : 'Send Privately'}
        </button>

        <p className="text-gray-500 text-xs text-center">
          Powered by ShadowWire (Radr Labs). Uses Bulletproof zero-knowledge proofs.
        </p>
      </div>
    </div>
  );
}
