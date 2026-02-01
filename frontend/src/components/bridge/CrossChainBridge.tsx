import { useState, useEffect } from 'react';
import { usePhantom, AddressType } from '@phantom/react-sdk';

interface BridgeProvider {
  id: 'silentswap' | 'shadowwire';
  name: string;
  description: string;
  privacyLevel: 'none' | 'high';
  feePercent: string;
  chains: string[];
  features: string[];
  enabled: boolean;
}

interface BridgeStatus {
  enabled: boolean;
  chains: string[];
  tokens: Record<string, string[]>;
  providers?: BridgeProvider[];
  defaultProvider?: string;
}

interface FeeEstimate {
  networkFee: number;
  protocolFee: number;
  totalFee: number;
  feePercentage: number;
}

interface BridgeQuote {
  provider: string;
  fromAmount: number;
  toAmount: number;
  exchangeRate: number;
  fee: number;
  feePercentage: number;
  estimatedTime: string;
  privacyLevel: 'none' | 'medium' | 'high';
  features: string[];
}

type ChainId = 'solana' | 'ethereum' | 'base' | 'polygon' | 'arbitrum';

const CHAIN_ICONS: Record<ChainId, string> = {
  solana: '◎',
  ethereum: 'Ξ',
  base: '🔵',
  polygon: '⬡',
  arbitrum: '🔷',
};

const CHAIN_NAMES: Record<ChainId, string> = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  base: 'Base',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
};

export function CrossChainBridge() {
  const { addresses } = usePhantom();
  const solanaAddress = addresses.find(addr => addr.addressType === AddressType.solana)?.address;

  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [providers, setProviders] = useState<BridgeProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<'silentswap' | 'shadowwire'>('silentswap');
  const [fromChain, setFromChain] = useState<ChainId>('solana');
  const [toChain, setToChain] = useState<ChainId>('base');
  const [fromToken, setFromToken] = useState('SOL');
  const [toToken, setToToken] = useState('ETH');
  const [amount, setAmount] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [fees, setFees] = useState<FeeEstimate | null>(null);
  const [quotes, setQuotes] = useState<BridgeQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch bridge status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  // Calculate fees when amount changes
  useEffect(() => {
    const amt = parseFloat(amount);
    if (!isNaN(amt) && amt > 0) {
      calculateFees(amt);
    } else {
      setFees(null);
    }
  }, [amount, fromChain, toChain]);

  // Update tokens when chain changes
  useEffect(() => {
    if (status) {
      const fromTokens = status.tokens[fromChain] || [];
      const toTokens = status.tokens[toChain] || [];
      if (!fromTokens.includes(fromToken)) {
        setFromToken(fromTokens[0] || 'SOL');
      }
      if (!toTokens.includes(toToken)) {
        setToToken(toTokens[0] || 'ETH');
      }
    }
  }, [fromChain, toChain, status]);

  const fetchStatus = async () => {
    try {
      const [statusRes, providersRes] = await Promise.all([
        fetch('/api/bridge/status'),
        fetch('/api/bridge/providers'),
      ]);

      const [statusData, providersData] = await Promise.all([
        statusRes.json(),
        providersRes.json(),
      ]);

      if (statusData.success) {
        setStatus({
          ...statusData.data,
          enabled: true, // Always enabled now with multi-provider support
        });
      }

      if (providersData.success && providersData.data?.providers) {
        setProviders(providersData.data.providers);
        // Set default provider
        const enabledProvider = providersData.data.providers.find((p: BridgeProvider) => p.enabled);
        if (enabledProvider) {
          setSelectedProvider(enabledProvider.id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch bridge status:', err);
      // Set default enabled state
      setStatus({
        enabled: true,
        chains: ['solana', 'ethereum', 'base', 'polygon', 'arbitrum'],
        tokens: {
          solana: ['SOL', 'USDC'],
          ethereum: ['ETH', 'USDC'],
          base: ['ETH', 'USDC'],
          polygon: ['MATIC', 'USDC'],
          arbitrum: ['ETH', 'USDC'],
        },
      });
    }
  };

  const calculateFees = async (amt: number) => {
    try {
      // Fetch fees and compare quotes from all providers
      const [feesRes, quotesRes] = await Promise.all([
        fetch(`/api/bridge/fees/estimate?amount=${amt}&fromChain=${fromChain}&toChain=${toChain}&fromToken=${fromToken}&toToken=${toToken}`),
        fetch(`/api/bridge/multi/compare?amount=${amt}&fromChain=${fromChain}&toChain=${toChain}&fromToken=${fromToken}&toToken=${toToken}`),
      ]);

      const [feesData, quotesData] = await Promise.all([
        feesRes.json(),
        quotesRes.json(),
      ]);

      if (feesData.success) {
        setFees(feesData.data);
      }

      if (quotesData.success && quotesData.data?.quotes) {
        setQuotes(quotesData.data.quotes);
      }
    } catch (err) {
      console.error('Failed to calculate fees:', err);
    }
  };

  const swapChains = () => {
    const tempChain = fromChain;
    const tempToken = fromToken;
    setFromChain(toChain);
    setToChain(tempChain);
    setFromToken(toToken);
    setToToken(tempToken);
  };

  const executeBridge = async () => {
    if (!solanaAddress || !amount || !toAddress) return;

    setLoading(true);
    setError(null);

    try {
      // Use multi-provider endpoint with selected provider
      const res = await fetch('/api/bridge/multi/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          fromChain,
          toChain,
          fromToken,
          toToken,
          amount: parseFloat(amount),
          fromAddress: solanaAddress,
          toAddress,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Show success and reset form
        setAmount('');
        setToAddress('');
        const providerName = providers.find(p => p.id === selectedProvider)?.name || selectedProvider;
        alert(`Bridge initiated via ${providerName}! Swap ID: ${data.data.swapId || 'pending'}`);
      } else {
        setError(data.error || 'Bridge failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bridge failed');
    } finally {
      setLoading(false);
    }
  };

  // Get selected provider info
  const selectedProviderInfo = providers.find(p => p.id === selectedProvider);

  if (!status?.enabled && providers.length === 0) {
    return (
      <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Cross-Chain Bridge</h2>
            <p className="text-sm text-gray-500">Privacy bridge to EVM chains</p>
          </div>
        </div>
        <div className="bg-cyan-500/10 rounded-xl p-4">
          <p className="text-cyan-400 text-sm">
            <span className="font-semibold">Loading...</span> Fetching available bridge providers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-white">Cross-Chain Bridge</h2>
          <p className="text-sm text-gray-500">
            {selectedProviderInfo
              ? `Via ${selectedProviderInfo.name} - ${selectedProviderInfo.privacyLevel === 'high' ? 'Privacy Mode' : 'Best Rates'}`
              : 'Multi-provider bridge to EVM chains'}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Provider Selector */}
        {providers.length > 0 && (
          <div>
            <label className="text-gray-400 text-sm mb-2 block">Bridge Provider</label>
            <div className="grid grid-cols-3 gap-2">
              {providers.filter(p => p.enabled).map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={`p-3 rounded-xl text-left transition-all ${
                    selectedProvider === provider.id
                      ? 'bg-cyan-500/20 border-cyan-500/50 border'
                      : 'bg-gray-800/50 border-gray-700 border hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white text-sm font-medium">{provider.name}</span>
                    {provider.privacyLevel === 'high' && (
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">ZK</span>
                    )}
                  </div>
                  <p className="text-gray-500 text-xs">{provider.feePercent} fee</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* From Chain */}
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-sm">From</span>
            <select
              value={fromChain}
              onChange={(e) => setFromChain(e.target.value as ChainId)}
              className="bg-gray-700 text-white rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {status.chains.map((chain) => (
                <option key={chain} value={chain}>
                  {CHAIN_ICONS[chain as ChainId]} {CHAIN_NAMES[chain as ChainId]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent text-2xl text-white focus:outline-none"
            />
            <select
              value={fromToken}
              onChange={(e) => setFromToken(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {(status.tokens[fromChain] || []).map((token) => (
                <option key={token} value={token}>{token}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={swapChains}
            className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To Chain */}
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-gray-400 text-sm">To</span>
            <select
              value={toChain}
              onChange={(e) => setToChain(e.target.value as ChainId)}
              className="bg-gray-700 text-white rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {status.chains.filter(c => c !== fromChain).map((chain) => (
                <option key={chain} value={chain}>
                  {CHAIN_ICONS[chain as ChainId]} {CHAIN_NAMES[chain as ChainId]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl text-gray-400">
              {fees ? `~${(parseFloat(amount) - fees.totalFee).toFixed(4)}` : '0.00'}
            </div>
            <select
              value={toToken}
              onChange={(e) => setToToken(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              {(status.tokens[toChain] || []).map((token) => (
                <option key={token} value={token}>{token}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Destination Address */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Destination Address</label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            placeholder={`Enter ${CHAIN_NAMES[toChain]} address...`}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 font-mono text-sm"
          />
        </div>

        {/* Fee Summary */}
        {fees && (
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Protocol Fee ({fees.feePercentage}%)</span>
              <span className="text-gray-300">{fees.protocolFee.toFixed(6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Network Fees</span>
              <span className="text-gray-300">~{fees.networkFee.toFixed(6)}</span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between">
              <span className="text-white font-medium">You Receive</span>
              <span className="text-white font-medium">
                ~{(parseFloat(amount) - fees.totalFee).toFixed(4)} {toToken}
              </span>
            </div>
          </div>
        )}

        {/* Provider Quotes Comparison */}
        {quotes.length > 1 && (
          <div className="bg-gray-800/50 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-2">Compare providers:</p>
            <div className="space-y-2">
              {quotes.map((quote, i) => (
                <div
                  key={quote.provider}
                  className={`flex items-center justify-between text-sm p-2 rounded-lg ${
                    quote.provider === selectedProvider ? 'bg-cyan-500/10 border border-cyan-500/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white">{providers.find(p => p.id === quote.provider)?.name || quote.provider}</span>
                    {quote.privacyLevel === 'high' && (
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">ZK</span>
                    )}
                    {i === 0 && <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Best Rate</span>}
                  </div>
                  <span className="text-gray-300">{quote.toAmount.toFixed(4)} {toToken}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Provider Info */}
        <div className={`rounded-xl p-4 ${
          selectedProviderInfo?.privacyLevel === 'high' ? 'bg-purple-500/10' : 'bg-cyan-500/10'
        }`}>
          <p className={`text-sm ${
            selectedProviderInfo?.privacyLevel === 'high' ? 'text-purple-400' : 'text-cyan-400'
          }`}>
            <span className="font-semibold">
              {selectedProviderInfo?.privacyLevel === 'high' ? 'Privacy Mode:' : 'Standard Mode:'}
            </span>{' '}
            {selectedProviderInfo?.privacyLevel === 'high'
              ? `${selectedProviderInfo?.name || 'SilentSwap'} uses ZK proofs to break the link between your source and destination wallets.`
              : `${selectedProviderInfo?.name || 'SilentSwap'} provides best rates via DEX aggregation across chains.`}
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={executeBridge}
          disabled={loading || !amount || !toAddress || !solanaAddress}
          className={`w-full py-4 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            selectedProviderInfo?.privacyLevel === 'high'
              ? 'bg-purple-500 hover:bg-purple-400'
              : 'bg-cyan-500 hover:bg-cyan-400'
          }`}
        >
          {loading
            ? 'Processing...'
            : `Bridge via ${selectedProviderInfo?.name || 'SilentSwap'}`}
        </button>

        <p className="text-gray-500 text-xs text-center">
          Powered by {selectedProviderInfo?.name || 'SilentSwap'}.{' '}
          {selectedProviderInfo?.privacyLevel === 'high' ? 'Privacy-preserving cross-chain bridge.' : 'Cross-chain DEX aggregator.'}
        </p>
      </div>
    </div>
  );
}
