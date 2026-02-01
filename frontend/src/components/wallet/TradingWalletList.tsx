import { useState, useEffect } from 'react';

interface TradingWallet {
  id: string;
  address: string;
  privateKey?: string;
  label?: string;
  solBalance?: number;
  usdcBalance?: number;
  createdAt: string;
}

interface WalletPair {
  id: string;
  primaryWallet: TradingWallet;
  batchWallet: TradingWallet;
  createdAt: string;
}

interface WithdrawalItem {
  wallet: string;
  walletId: string;
  success: boolean;
  amountWithdrawn: number;
  token: string;
  intermediateWallet?: string;
  depositSignature?: string;
  withdrawSignature?: string;
  privacyProtected: boolean;
  errors?: string[];
}

interface WithdrawResult {
  pairId: string;
  withdrawals: WithdrawalItem[];
  mainWalletAddress: string;
  privacyProtected: boolean;
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function TradingWalletList() {
  const [walletPairs, setWalletPairs] = useState<WalletPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Transfer modal state
  const [transferModalOpen, setTransferModalOpen] = useState<{ pairId: string; walletType: 'primary' | 'batch' } | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferToken, setTransferToken] = useState<'sol' | 'usdc'>('usdc');
  const [transferProvider, setTransferProvider] = useState<'shadowwire' | 'privacycash'>('shadowwire');
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<{ success: boolean; message: string } | null>(null);

  // Export modal state
  const [exportModalOpen, setExportModalOpen] = useState<string | null>(null);
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [exportedKeys, setExportedKeys] = useState<{ primary: TradingWallet; batch: TradingWallet } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Withdraw modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState<string | null>(null);
  const [withdrawType, setWithdrawType] = useState<'primary' | 'batch' | 'all'>('all');
  const [withdrawToken, setWithdrawToken] = useState<'sol' | 'usdc' | 'all'>('all');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawResult | null>(null);

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [forceDelete, setForceDelete] = useState(false);

  const fetchWalletPairs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/wallet/pairs`);
      const data = await res.json();
      if (data.success) {
        setWalletPairs(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch wallet pairs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWalletPairs();
    const interval = setInterval(fetchWalletPairs, 30000);
    return () => clearInterval(interval);
  }, []);

  const createWalletPair = async () => {
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/wallet/pairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        await fetchWalletPairs();
      }
    } catch (error) {
      console.error('Failed to create wallet pair:', error);
    } finally {
      setCreating(false);
    }
  };

  const transferToWallet = async (walletId: string) => {
    if (!transferAmount || parseFloat(transferAmount) <= 0) return;

    setTransferring(true);
    setTransferResult(null);

    try {
      const res = await fetch(`${API_URL}/api/transfer/privacy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toWalletId: walletId,
          amount: parseFloat(transferAmount),
          token: transferToken,
          provider: transferProvider,
          usePrivacyPool: true,
          background: transferProvider === 'shadowwire', // Privacy Cash is synchronous
        }),
      });
      const data = await res.json();
      if (data.success) {
        const providerName = transferProvider === 'privacycash' ? 'Privacy Cash' : 'ShadowWire';
        setTransferResult({
          success: true,
          message: transferProvider === 'privacycash'
            ? `Transfer complete via ${providerName}! ${transferAmount} ${transferToken.toUpperCase()} sent.`
            : `Transfer started via ${providerName}! Processing ${transferAmount} ${transferToken.toUpperCase()} in background.`,
        });

        const operationId = data.data?.operationId;
        if (operationId) {
          console.log(`[Transfer] Background operation started: ${operationId}`);
        }

        setTimeout(() => {
          setTransferModalOpen(null);
          setTransferAmount('');
          setTransferResult(null);
        }, 2000);

        const pollBalances = async () => {
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 10000));
            await fetchWalletPairs();
          }
        };
        pollBalances();
      } else {
        setTransferResult({
          success: false,
          message: data.error || 'Transfer failed',
        });
      }
    } catch (error: any) {
      setTransferResult({
        success: false,
        message: error.message || 'Failed to transfer',
      });
    } finally {
      setTransferring(false);
    }
  };

  const exportPrivateKeys = async (pairId: string) => {
    if (exportConfirmation !== 'EXPORT') {
      setExportError('Please type the confirmation phrase exactly');
      return;
    }

    setExporting(true);
    setExportError(null);

    try {
      const res = await fetch(`${API_URL}/api/wallet/pairs/${pairId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmExport: 'EXPORT' }),
      });
      const data = await res.json();
      if (data.success) {
        setExportedKeys(data.data);
      } else {
        setExportError(data.error || 'Failed to export keys');
      }
    } catch (error: any) {
      setExportError(error.message || 'Failed to export keys');
    } finally {
      setExporting(false);
    }
  };

  const withdrawFunds = async (pairId: string) => {
    setWithdrawing(true);
    setWithdrawResult(null);

    try {
      const res = await fetch(`${API_URL}/api/wallet/pairs/${pairId}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletType: withdrawType, token: withdrawToken }),
      });
      const data = await res.json();
      if (data.success) {
        setWithdrawResult(data.data);
        fetchWalletPairs();
      } else {
        setWithdrawResult({
          pairId: pairId,
          withdrawals: [{
            wallet: 'error',
            walletId: '',
            success: false,
            amountWithdrawn: 0,
            token: withdrawToken,
            privacyProtected: false,
            errors: [data.error || 'Withdraw failed'],
          }],
          mainWalletAddress: '',
          privacyProtected: false,
        });
      }
    } catch (error: any) {
      setWithdrawResult({
        pairId: pairId,
        withdrawals: [{
          wallet: 'error',
          walletId: '',
          success: false,
          amountWithdrawn: 0,
          token: withdrawToken,
          privacyProtected: false,
          errors: [error.message || 'Failed to withdraw'],
        }],
        mainWalletAddress: '',
        privacyProtected: false,
      });
    } finally {
      setWithdrawing(false);
    }
  };

  const deleteWalletPair = async (pairId: string) => {
    if (deleteConfirmation !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm');
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      const url = forceDelete
        ? `${API_URL}/api/wallet/pairs/${pairId}?force=true`
        : `${API_URL}/api/wallet/pairs/${pairId}`;

      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        setDeleteModalOpen(null);
        setDeleteConfirmation('');
        setForceDelete(false);
        await fetchWalletPairs();
      } else {
        setDeleteError(data.error || 'Failed to delete wallet pair');
      }
    } catch (error: any) {
      setDeleteError(error.message || 'Failed to delete wallet pair');
    } finally {
      setDeleting(false);
    }
  };

  const getWalletFromModal = (): TradingWallet | null => {
    if (!transferModalOpen) return null;
    const pair = walletPairs.find(p => p.id === transferModalOpen.pairId);
    if (!pair) return null;
    return transferModalOpen.walletType === 'primary' ? pair.primaryWallet : pair.batchWallet;
  };

  const getPairFromModal = (modalPairId: string | null): WalletPair | null => {
    if (!modalPairId) return null;
    return walletPairs.find(p => p.id === modalPairId) || null;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getTotalBalance = (pair: WalletPair): number => {
    return (pair.primaryWallet.solBalance || 0) +
           (pair.primaryWallet.usdcBalance || 0) +
           (pair.batchWallet.solBalance || 0) +
           (pair.batchWallet.usdcBalance || 0);
  };

  if (loading) {
    return <div className="text-center py-4 text-gray-400">Loading wallet pairs...</div>;
  }

  return (
    <div className="space-y-4 pt-4 border-t border-gray-700">
      <p className="text-sm text-gray-400">
        Privacy wallets are created in pairs: one for primary trading, one for batch operations.
      </p>

      {walletPairs.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-700 rounded-lg">
          <p className="text-gray-400 mb-2">No privacy wallet pairs created yet</p>
          <p className="text-xs text-gray-500 mb-4">
            Creates 2 wallets: Primary Trading + Batch Trading
          </p>
          <button
            onClick={createWalletPair}
            disabled={creating}
            className="bg-white text-gray-900 px-6 py-2.5 font-medium rounded-lg disabled:opacity-50 hover:bg-gray-100 transition-colors"
          >
            {creating ? 'Creating Wallet Pair...' : 'Create Trading Wallet Pair'}
          </button>
        </div>
      ) : (
        <>
          {walletPairs.map((pair) => (
            <div key={pair.id} className="border border-gray-700 rounded-lg overflow-hidden">
              {/* Pair Header */}
              <div className="bg-white text-gray-900 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="font-medium text-sm">
                    Privacy Wallet Pair
                  </span>
                </div>
                <span className="text-xs font-mono text-gray-500">
                  {pair.id}
                </span>
              </div>

              {/* Wallets Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2">
                {/* Primary Trading Wallet */}
                <div className="p-4 border-b md:border-b-0 md:border-r border-gray-700 bg-gray-900">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-white"></span>
                      <span className="font-medium text-sm text-white">
                        {pair.primaryWallet.label}
                      </span>
                    </div>
                    <a
                      href={`https://solscan.io/account/${pair.primaryWallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-white font-mono transition-colors"
                    >
                      {pair.primaryWallet.address.slice(0, 4)}...{pair.primaryWallet.address.slice(-4)}
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-500 text-xs">SOL</span>
                      <p className="font-mono text-white">{pair.primaryWallet.solBalance?.toFixed(4) || '0.0000'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-xs">USDC</span>
                      <p className="font-mono text-white">
                        ${pair.primaryWallet.usdcBalance?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setTransferModalOpen({ pairId: pair.id, walletType: 'primary' })}
                    className="w-full bg-white text-gray-900 py-2 text-xs font-medium rounded hover:bg-gray-100 transition-colors"
                  >
                    Fund via Privacy Pool
                  </button>
                </div>

                {/* Batch Trading Wallet */}
                <div className="p-4 bg-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                      <span className="font-medium text-sm text-white">
                        {pair.batchWallet.label}
                      </span>
                    </div>
                    <a
                      href={`https://solscan.io/account/${pair.batchWallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-500 hover:text-white font-mono transition-colors"
                    >
                      {pair.batchWallet.address.slice(0, 4)}...{pair.batchWallet.address.slice(-4)}
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-500 text-xs">SOL</span>
                      <p className="font-mono text-white">{pair.batchWallet.solBalance?.toFixed(4) || '0.0000'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-xs">USDC</span>
                      <p className="font-mono text-white">
                        ${pair.batchWallet.usdcBalance?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setTransferModalOpen({ pairId: pair.id, walletType: 'batch' })}
                    className="w-full bg-gray-600 text-white py-2 text-xs font-medium rounded hover:bg-gray-500 transition-colors"
                  >
                    Fund via Privacy Pool
                  </button>
                </div>
              </div>

              {/* Wallet Actions */}
              <div className="px-4 py-3 border-t border-gray-700 bg-gray-800">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setExportModalOpen(pair.id);
                      setExportConfirmation('');
                      setExportedKeys(null);
                      setExportError(null);
                    }}
                    className="flex-1 min-w-[100px] py-2 text-xs font-medium border border-gray-600 text-gray-300 hover:border-white hover:text-white rounded transition-colors"
                  >
                    Export Keys
                  </button>
                  <button
                    onClick={() => {
                      setWithdrawModalOpen(pair.id);
                      setWithdrawType('all');
                      setWithdrawToken('all');
                      setWithdrawResult(null);
                    }}
                    className="flex-1 min-w-[100px] py-2 text-xs font-medium border border-white text-white hover:bg-white hover:text-gray-900 rounded transition-colors"
                  >
                    Withdraw
                  </button>
                  <button
                    onClick={() => {
                      setDeleteModalOpen(pair.id);
                      setDeleteConfirmation('');
                      setDeleteError(null);
                      setForceDelete(false);
                    }}
                    className="flex-1 min-w-[100px] py-2 text-xs font-medium border border-red-500 text-red-500 hover:bg-red-500 hover:text-white rounded transition-colors"
                  >
                    Close Wallet
                  </button>
                </div>
              </div>

              {/* Privacy Indicator */}
              <div className="bg-gray-800 px-4 py-2 border-t border-gray-700">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-gray-400">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="font-medium">Zero On-Chain Link to Main Wallet</span>
                  </div>
                  <span className="text-gray-500">
                    Created {new Date(pair.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={createWalletPair}
            disabled={creating}
            className="w-full py-3 border border-dashed border-gray-600 text-gray-400 font-medium rounded-lg hover:border-white hover:text-white disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating...' : '+ Create Another Wallet Pair'}
          </button>
        </>
      )}

      {/* Transfer Modal */}
      {transferModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg shadow-lg max-w-sm w-full border border-gray-700">
            <div className="p-6">
              <h3 className="font-semibold text-lg mb-1 text-white">
                Privacy Pool Transfer
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                to {getWalletFromModal()?.label}
              </p>

              {/* Privacy Notice */}
              <div className="bg-gray-800 border border-gray-700 p-3 mb-4 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="text-sm font-medium text-white">Privacy Protected</span>
                </div>
                <p className="text-xs text-gray-400">
                  Funds will be routed through a ZK privacy pool, breaking any on-chain link to your main wallet.
                </p>
              </div>

              <div className="space-y-4">
                {/* Token Selector */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setTransferToken('usdc')}
                    className={`flex-1 py-2 font-medium text-sm rounded transition-colors ${
                      transferToken === 'usdc'
                        ? 'bg-white text-gray-900'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    USDC
                  </button>
                  <button
                    onClick={() => setTransferToken('sol')}
                    className={`flex-1 py-2 font-medium text-sm rounded transition-colors ${
                      transferToken === 'sol'
                        ? 'bg-white text-gray-900'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    SOL
                  </button>
                </div>

                {/* Privacy Provider Selector */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Privacy Provider</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTransferProvider('shadowwire')}
                      className={`flex-1 py-2 font-medium text-xs rounded transition-colors ${
                        transferProvider === 'shadowwire'
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <div>ShadowWire</div>
                      <div className="text-[10px] opacity-70">0.5% fee • ZK Proofs</div>
                    </button>
                    <button
                      onClick={() => setTransferProvider('privacycash')}
                      className={`flex-1 py-2 font-medium text-xs rounded transition-colors ${
                        transferProvider === 'privacycash'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <div>Privacy Cash</div>
                      <div className="text-[10px] opacity-70">1% fee • Light Protocol</div>
                    </button>
                  </div>
                </div>

                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder={`Amount in ${transferToken.toUpperCase()}`}
                  className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg font-mono text-white placeholder-gray-500 focus:border-white focus:ring-1 focus:ring-white"
                  min="0"
                  step="0.01"
                />

                {transferResult && (
                  <div className={`p-3 rounded-lg ${
                    transferResult.success
                      ? 'bg-green-900/50 border border-green-700 text-green-400'
                      : 'bg-red-900/50 border border-red-700 text-red-400'
                  }`}>
                    <p className="text-sm font-medium">{transferResult.message}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setTransferModalOpen(null);
                      setTransferAmount('');
                      setTransferResult(null);
                    }}
                    className="flex-1 py-2.5 font-medium border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    {transferResult?.success ? 'Close' : 'Cancel'}
                  </button>
                  {!transferResult?.success && (
                    <button
                      onClick={() => transferToWallet(getWalletFromModal()?.id || '')}
                      disabled={transferring || !transferAmount || parseFloat(transferAmount) <= 0}
                      className="flex-1 py-2.5 font-medium bg-white text-gray-900 rounded-lg disabled:opacity-50 hover:bg-gray-100 transition-colors"
                    >
                      {transferring ? 'Starting...' : 'Transfer'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Keys Modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg shadow-lg max-w-md w-full border border-gray-700">
            <div className="p-6">
              <h3 className="font-semibold text-lg mb-4 text-red-500">
                Export Private Keys
              </h3>

              {!exportedKeys ? (
                <>
                  {/* Warning */}
                  <div className="bg-red-900/30 border border-red-700 p-4 mb-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="font-medium text-red-500">Security Warning</span>
                    </div>
                    <ul className="text-xs text-gray-300 space-y-1">
                      <li>Private keys give FULL access to wallet funds</li>
                      <li>Never share private keys with anyone</li>
                      <li>Store exported keys securely offline</li>
                      <li>Anyone with these keys can steal your funds</li>
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-white">
                        Type "EXPORT" to confirm:
                      </label>
                      <input
                        type="text"
                        value={exportConfirmation}
                        onChange={(e) => setExportConfirmation(e.target.value)}
                        className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg font-mono text-sm text-white"
                        placeholder="EXPORT"
                      />
                    </div>

                    {exportError && (
                      <div className="p-3 bg-red-900/50 border border-red-700 text-red-400 rounded-lg">
                        <p className="text-sm font-medium">{exportError}</p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => setExportModalOpen(null)}
                        disabled={exporting}
                        className="flex-1 py-2.5 font-medium border border-gray-600 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => exportPrivateKeys(exportModalOpen)}
                        disabled={exporting || exportConfirmation !== 'EXPORT'}
                        className="flex-1 py-2.5 font-medium bg-red-600 text-white rounded-lg disabled:opacity-50 hover:bg-red-700 transition-colors"
                      >
                        {exporting ? 'Exporting...' : 'Export Keys'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="bg-green-900/50 border border-green-700 p-3 rounded-lg">
                      <p className="text-sm font-medium text-green-400">Keys exported successfully. Store them securely!</p>
                    </div>

                    {/* Primary Wallet */}
                    <div className="border border-gray-700 p-3 rounded-lg">
                      <p className="font-medium text-sm mb-2 text-white">{exportedKeys.primary.label}</p>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-gray-500">Address</label>
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-gray-800 p-2 flex-1 overflow-x-auto rounded text-gray-300">
                              {exportedKeys.primary.address}
                            </code>
                            <button
                              onClick={() => copyToClipboard(exportedKeys.primary.address)}
                              className="p-2 border border-gray-600 text-xs text-gray-300 rounded hover:bg-gray-800"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-red-500 font-medium">Private Key (SECRET!)</label>
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-red-900/30 p-2 flex-1 overflow-x-auto text-red-400 rounded">
                              {exportedKeys.primary.privateKey}
                            </code>
                            <button
                              onClick={() => copyToClipboard(exportedKeys.primary.privateKey || '')}
                              className="p-2 border border-red-700 text-xs text-red-500 rounded hover:bg-red-900/30"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Batch Wallet */}
                    <div className="border border-gray-700 p-3 rounded-lg">
                      <p className="font-medium text-sm mb-2 text-white">{exportedKeys.batch.label}</p>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-gray-500">Address</label>
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-gray-800 p-2 flex-1 overflow-x-auto rounded text-gray-300">
                              {exportedKeys.batch.address}
                            </code>
                            <button
                              onClick={() => copyToClipboard(exportedKeys.batch.address)}
                              className="p-2 border border-gray-600 text-xs text-gray-300 rounded hover:bg-gray-800"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-red-500 font-medium">Private Key (SECRET!)</label>
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-red-900/30 p-2 flex-1 overflow-x-auto text-red-400 rounded">
                              {exportedKeys.batch.privateKey}
                            </code>
                            <button
                              onClick={() => copyToClipboard(exportedKeys.batch.privateKey || '')}
                              className="p-2 border border-red-700 text-xs text-red-500 rounded hover:bg-red-900/30"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setExportModalOpen(null)}
                      className="w-full py-2.5 font-medium border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Withdraw Modal */}
      {withdrawModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg shadow-lg max-w-md w-full border border-gray-700">
            <div className="p-6">
              <h3 className="font-semibold text-lg mb-4 text-white">
                Privacy Pool Withdrawal
              </h3>

              {(() => {
                const pair = getPairFromModal(withdrawModalOpen);
                if (!pair) return null;

                return (
                  <>
                    <p className="text-sm text-gray-400 mb-4">
                      Withdraw funds back to your main wallet via privacy pool.
                    </p>

                    {/* Privacy Notice */}
                    <div className="bg-gray-800 border border-gray-700 p-3 mb-4 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        <span className="text-sm font-medium text-white">Privacy Protected</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        Withdrawals are routed through a ZK privacy pool, breaking any on-chain link back to your main wallet.
                      </p>
                    </div>

                    {/* Current Balances */}
                    <div className="border border-gray-700 p-3 mb-4 space-y-2 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Primary Wallet:</span>
                        <span className="font-mono text-white">
                          {pair.primaryWallet.solBalance?.toFixed(4)} SOL / ${pair.primaryWallet.usdcBalance?.toFixed(2)} USDC
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Batch Wallet:</span>
                        <span className="font-mono text-white">
                          {pair.batchWallet.solBalance?.toFixed(4)} SOL / ${pair.batchWallet.usdcBalance?.toFixed(2)} USDC
                        </span>
                      </div>
                    </div>

                    {/* Token Selection */}
                    <div className="space-y-2 mb-4">
                      <label className="block text-sm font-medium text-white">Token to withdraw:</label>
                      <div className="flex gap-2">
                        {['all', 'usdc', 'sol'].map((token) => (
                          <button
                            key={token}
                            onClick={() => setWithdrawToken(token as typeof withdrawToken)}
                            className={`flex-1 py-2 text-xs font-medium rounded transition-colors ${
                              withdrawToken === token
                                ? 'bg-white text-gray-900'
                                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            {token.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Withdraw Type Selection */}
                    <div className="space-y-2 mb-4">
                      <label className="block text-sm font-medium text-white">Withdraw from:</label>
                      <div className="flex gap-2">
                        {[
                          { value: 'all', label: 'Both' },
                          { value: 'primary', label: 'Primary' },
                          { value: 'batch', label: 'Batch' },
                        ].map((type) => (
                          <button
                            key={type.value}
                            onClick={() => setWithdrawType(type.value as typeof withdrawType)}
                            className={`flex-1 py-2 text-xs font-medium rounded transition-colors ${
                              withdrawType === type.value
                                ? 'bg-white text-gray-900'
                                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            {type.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {withdrawResult && (
                      <div className={`p-3 rounded-lg mb-4 ${
                        withdrawResult.privacyProtected
                          ? 'bg-green-900/50 border border-green-700'
                          : 'bg-red-900/50 border border-red-700'
                      }`}>
                        <div className="text-sm space-y-2">
                          {withdrawResult.withdrawals.map((w, i) => (
                            <div key={i} className={w.success ? 'text-green-400' : 'text-red-400'}>
                              <p className="font-medium capitalize">{w.wallet} Wallet:</p>
                              {w.success ? (
                                <p>{w.amountWithdrawn.toFixed(4)} {w.token.toUpperCase()} withdrawn</p>
                              ) : (
                                <p>{w.errors?.join(', ') || 'Failed'}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => setWithdrawModalOpen(null)}
                        disabled={withdrawing}
                        className="flex-1 py-2.5 font-medium border border-gray-600 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-800 transition-colors"
                      >
                        {withdrawResult ? 'Close' : 'Cancel'}
                      </button>
                      {!withdrawResult && (
                        <button
                          onClick={() => withdrawFunds(withdrawModalOpen)}
                          disabled={withdrawing}
                          className="flex-1 py-2.5 font-medium bg-white text-gray-900 rounded-lg disabled:opacity-50 hover:bg-gray-100 transition-colors"
                        >
                          {withdrawing
                            ? 'Processing...'
                            : `Withdraw ${withdrawToken === 'all' ? 'All' : withdrawToken.toUpperCase()}`
                          }
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Delete Wallet Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg shadow-lg max-w-sm w-full border border-gray-700">
            <div className="p-6">
              <h3 className="font-semibold text-lg mb-4 text-red-500">
                Close Wallet Pair
              </h3>

              {(() => {
                const pair = getPairFromModal(deleteModalOpen);
                if (!pair) return null;
                const totalBalance = getTotalBalance(pair);

                return (
                  <>
                    {totalBalance > 0 && (
                      <div className="bg-red-900/30 border border-red-700 p-4 mb-4 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span className="font-medium text-red-500">Warning: Funds Remaining</span>
                        </div>
                        <p className="text-sm text-gray-300 mb-2">
                          This wallet pair still has funds. Withdraw them first or check "Force delete" to proceed.
                        </p>
                        <div className="text-sm font-mono text-gray-400">
                          <p>Primary: {pair.primaryWallet.solBalance?.toFixed(4)} SOL / ${pair.primaryWallet.usdcBalance?.toFixed(2)} USDC</p>
                          <p>Batch: {pair.batchWallet.solBalance?.toFixed(4)} SOL / ${pair.batchWallet.usdcBalance?.toFixed(2)} USDC</p>
                        </div>
                        <label className="flex items-center gap-2 mt-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={forceDelete}
                            onChange={(e) => setForceDelete(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-800"
                          />
                          <span className="text-sm font-medium text-red-500">
                            Force delete (I understand funds may be lost)
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2 text-white">
                          Type "DELETE" to confirm:
                        </label>
                        <input
                          type="text"
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg font-mono text-white"
                          placeholder="DELETE"
                        />
                      </div>

                      {deleteError && (
                        <div className="p-3 bg-red-900/50 border border-red-700 text-red-400 rounded-lg">
                          <p className="text-sm font-medium">{deleteError}</p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => setDeleteModalOpen(null)}
                          disabled={deleting}
                          className="flex-1 py-2.5 font-medium border border-gray-600 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-800 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => deleteWalletPair(deleteModalOpen)}
                          disabled={deleting || deleteConfirmation !== 'DELETE' || (totalBalance > 0 && !forceDelete)}
                          className="flex-1 py-2.5 font-medium bg-red-600 text-white rounded-lg disabled:opacity-50 hover:bg-red-700 transition-colors"
                        >
                          {deleting ? 'Deleting...' : 'Delete Wallet Pair'}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
