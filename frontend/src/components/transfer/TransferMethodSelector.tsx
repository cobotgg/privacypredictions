import { useState, useEffect } from 'react';
import { usePhantom, AddressType } from '@phantom/react-sdk';
import { TransactionCompliance } from '../compliance/ComplianceBadge';

type TransferMethod = 'shadowwire' | 'bridge';

interface TransferMethodConfig {
  id: TransferMethod;
  name: string;
  description: string;
  icon: string;
  color: string;
  features: string[];
  enabled: boolean;
}

interface TransferState {
  method: TransferMethod;
  recipient: string;
  amount: string;
  token: string;
  toChain?: string;
}

export function TransferMethodSelector() {
  const { addresses } = usePhantom();
  const solanaAddress = addresses.find(addr => addr.addressType === AddressType.solana)?.address;

  const [methods, setMethods] = useState<TransferMethodConfig[]>([
    {
      id: 'shadowwire',
      name: 'Private Transfer',
      description: 'ShadowWire ZK privacy',
      icon: '🔒',
      color: 'purple',
      features: ['Hidden amount', 'Anonymous sender', 'ZK proofs'],
      enabled: true,
    },
    {
      id: 'bridge',
      name: 'Cross-Chain Bridge',
      description: 'Via LI.FI / SilentSwap',
      icon: '⛓',
      color: 'cyan',
      features: ['Multi-chain', 'Privacy bridge', 'ETH/Base/Polygon'],
      enabled: false,
    },
  ]);

  const [transfer, setTransfer] = useState<TransferState>({
    method: 'shadowwire',
    recipient: '',
    amount: '',
    token: 'SOL',
  });

  const [showCompliance, setShowCompliance] = useState(false);
  const [complianceRecommendation, setComplianceRecommendation] = useState<'allow' | 'review' | 'block' | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch integration status on mount
  useEffect(() => {
    checkIntegrations();
  }, []);

  const checkIntegrations = async () => {
    try {
      // Fetch both shadowwire status and bridge providers
      const [shadowwireRes, bridgeRes, providersRes] = await Promise.all([
        fetch('/api/shadowwire/status').catch(() => ({ json: () => ({ data: { enabled: true } }) })),
        fetch('/api/bridge/status'),
        fetch('/api/bridge/providers'),
      ]);

      const [shadowwireData, bridgeData, providersData] = await Promise.all([
        shadowwireRes.json(),
        bridgeRes.json(),
        providersRes.json(),
      ]);

      // Check if any bridge provider is available
      const providers = providersData.data?.providers || [];
      const hasLiFi = providers.find((p: { id: string; enabled: boolean }) => p.id === 'lifi')?.enabled;
      const hasSilentSwap = providers.find((p: { id: string; enabled: boolean }) => p.id === 'silentswap')?.enabled;
      const hasShadowWire = providers.find((p: { id: string; enabled: boolean }) => p.id === 'shadowwire')?.enabled;

      // Bridge is enabled if any provider is available
      const bridgeEnabled = bridgeData.data?.enabled || hasLiFi || hasSilentSwap;

      // ShadowWire can work via the shadowwire status endpoint OR via bridge providers
      const shadowwireEnabled = shadowwireData.data?.enabled || hasShadowWire;

      setMethods(prev => prev.map(m => {
        if (m.id === 'shadowwire') {
          return {
            ...m,
            enabled: shadowwireEnabled,
            description: hasShadowWire ? 'ShadowWire ZK privacy' : 'ShadowWire ZK privacy',
          };
        }
        if (m.id === 'bridge') {
          // Update description based on available providers
          const providerNames = [];
          if (hasLiFi) providerNames.push('LI.FI');
          if (hasSilentSwap) providerNames.push('SilentSwap');
          return {
            ...m,
            enabled: bridgeEnabled,
            description: providerNames.length > 0
              ? `Via ${providerNames.join(' / ')}`
              : 'Cross-chain to EVM',
            features: [
              'Multi-chain',
              hasLiFi ? 'Best rates' : 'Privacy bridge',
              hasSilentSwap ? 'Privacy routing' : 'ETH/Base/Polygon',
            ],
          };
        }
        return m;
      }));
    } catch (err) {
      console.error('Failed to check integrations:', err);
      // Enable by default in case of error - let backend handle validation
      setMethods(prev => prev.map(m => ({
        ...m,
        enabled: true,
      })));
    }
  };

  const handleMethodSelect = (methodId: TransferMethod) => {
    const method = methods.find(m => m.id === methodId);
    if (method?.enabled) {
      setTransfer(prev => ({ ...prev, method: methodId }));
      setResult(null);
    }
  };

  const handleExecuteTransfer = async () => {
    if (!solanaAddress || !transfer.recipient || !transfer.amount) return;

    // Check compliance first
    if (complianceRecommendation === 'block') {
      setResult({ success: false, message: 'Transaction blocked by compliance' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      let endpoint = '';
      let body: Record<string, unknown> = {};

      switch (transfer.method) {
        case 'shadowwire':
          endpoint = '/api/shadowwire/transfer';
          body = {
            sender: solanaAddress,
            recipient: transfer.recipient,
            amount: parseFloat(transfer.amount),
            token: transfer.token,
          };
          break;

        case 'bridge':
          endpoint = '/api/bridge/swap';
          body = {
            fromChain: 'solana',
            toChain: transfer.toChain || 'base',
            fromToken: transfer.token,
            toToken: transfer.toChain === 'polygon' ? 'MATIC' : 'ETH',
            amount: parseFloat(transfer.amount),
            fromAddress: solanaAddress,
            toAddress: transfer.recipient,
          };
          break;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        setResult({
          success: true,
          message: getSuccessMessage(transfer.method, data.data),
        });
        // Reset form
        setTransfer(prev => ({ ...prev, recipient: '', amount: '' }));
      } else {
        setResult({ success: false, message: data.error || 'Transfer failed' });
      }
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'Transfer failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const getSuccessMessage = (method: TransferMethod, data: unknown): string => {
    const d = data as Record<string, unknown>;
    switch (method) {
      case 'shadowwire':
        return `Private transfer complete! Type: ${d.transferType || 'external'}`;
      case 'bridge':
        return `Bridge initiated! Swap ID: ${d.swapId || 'pending'}`;
    }
  };

  const selectedMethod = methods.find(m => m.id === transfer.method);

  const getColorClasses = (color: string, selected: boolean) => {
    const colorMap: Record<string, { bg: string; border: string; text: string }> = {
      purple: {
        bg: selected ? 'bg-purple-500/20' : 'bg-gray-800/50',
        border: selected ? 'border-purple-500/50' : 'border-gray-700',
        text: 'text-purple-400',
      },
      cyan: {
        bg: selected ? 'bg-cyan-500/20' : 'bg-gray-800/50',
        border: selected ? 'border-cyan-500/50' : 'border-gray-700',
        text: 'text-cyan-400',
      },
    };
    return colorMap[color] || colorMap.purple;
  };

  return (
    <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500/20 to-indigo-600/10 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-white">Send Assets</h2>
          <p className="text-sm text-gray-500">Choose your transfer method</p>
        </div>
      </div>

      {/* Method Selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {methods.map((method) => {
          const colors = getColorClasses(method.color, transfer.method === method.id);
          const isDisabled = !method.enabled;

          return (
            <button
              key={method.id}
              onClick={() => handleMethodSelect(method.id)}
              disabled={isDisabled}
              className={`relative p-4 rounded-xl border ${colors.bg} ${colors.border} text-left transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className={`text-2xl mb-2 ${colors.text}`}>{method.icon}</div>
              <h3 className="text-white font-medium text-sm">{method.name}</h3>
              <p className="text-gray-500 text-xs mt-1">{method.description}</p>
              {isDisabled && (
                <span className="absolute top-2 right-2 bg-gray-700 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                  Not configured
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Method Features */}
      {selectedMethod && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selectedMethod.features.map((feature, i) => (
            <span
              key={i}
              className={`text-xs px-2 py-1 rounded-full ${
                getColorClasses(selectedMethod.color, true).bg
              } ${getColorClasses(selectedMethod.color, true).text}`}
            >
              {feature}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {/* Token Selector */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Token</label>
          <div className="flex gap-2">
            {['SOL', 'USDC'].map((tok) => (
              <button
                key={tok}
                onClick={() => setTransfer(prev => ({ ...prev, token: tok }))}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  transfer.token === tok
                    ? 'bg-indigo-500 text-white'
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
          <label className="text-gray-400 text-sm mb-2 block">
            {transfer.method === 'bridge' ? 'Destination Address (EVM)' : 'Recipient Address'}
          </label>
          <input
            type="text"
            value={transfer.recipient}
            onChange={(e) => {
              setTransfer(prev => ({ ...prev, recipient: e.target.value }));
              setShowCompliance(e.target.value.length > 30);
            }}
            placeholder={transfer.method === 'bridge' ? '0x...' : 'Enter Solana address...'}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono text-sm"
          />
        </div>

        {/* Chain Selector (only for bridge) */}
        {transfer.method === 'bridge' && (
          <div>
            <label className="text-gray-400 text-sm mb-2 block">Destination Chain</label>
            <div className="flex gap-2">
              {['base', 'ethereum', 'polygon'].map((chain) => (
                <button
                  key={chain}
                  onClick={() => setTransfer(prev => ({ ...prev, toChain: chain }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    (transfer.toChain || 'base') === chain
                      ? 'bg-cyan-500 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {chain}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Amount</label>
          <div className="relative">
            <input
              type="number"
              value={transfer.amount}
              onChange={(e) => setTransfer(prev => ({ ...prev, amount: e.target.value }))}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              {transfer.token}
            </span>
          </div>
        </div>

        {/* Compliance Check */}
        {showCompliance && solanaAddress && transfer.recipient && (
          <TransactionCompliance
            fromAddress={solanaAddress}
            toAddress={transfer.recipient}
            onScreeningComplete={setComplianceRecommendation}
          />
        )}

        {/* Result Message */}
        {result && (
          <div
            className={`p-4 rounded-xl ${
              result.success
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {result.message}
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleExecuteTransfer}
          disabled={
            loading ||
            !transfer.recipient ||
            !transfer.amount ||
            !solanaAddress ||
            complianceRecommendation === 'block'
          }
          className={`w-full py-4 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            transfer.method === 'shadowwire'
              ? 'bg-purple-500 hover:bg-purple-400 text-white'
              : 'bg-cyan-500 hover:bg-cyan-400 text-white'
          }`}
        >
          {loading
            ? 'Processing...'
            : transfer.method === 'shadowwire'
            ? 'Send Privately'
            : 'Bridge Assets'}
        </button>

        {/* Method-specific footer */}
        <p className="text-gray-500 text-xs text-center">
          {transfer.method === 'shadowwire' && 'Powered by ShadowWire (Radr Labs). Uses ZK proofs for privacy.'}
          {transfer.method === 'bridge' && 'Powered by LI.FI / SilentSwap. Privacy bridge to EVM chains.'}
        </p>
      </div>
    </div>
  );
}
