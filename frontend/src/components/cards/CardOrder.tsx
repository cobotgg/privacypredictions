import { useState, useEffect } from 'react';

interface CardConfig {
  enabled: boolean;
  defaultAmount: number;
  emailConfigured: boolean;
}

interface CardPricing {
  cardValue: number;
  starpayFeePercent: number;
  starpayFee: number;
  resellerMarkup: number;
  total: number;
}

interface CardOrder {
  orderId: string;
  status: string;
  payment: {
    address: string;
    amountSol: number;
    solPrice: number;
  };
  pricing: CardPricing;
  expiresAt: string;
}

export function CardOrder() {
  const [config, setConfig] = useState<CardConfig | null>(null);
  const [amount, setAmount] = useState(5);
  const [email, setEmail] = useState('');
  const [cardType, setCardType] = useState<'visa' | 'mastercard'>('visa');
  const [pricing, setPricing] = useState<CardPricing | null>(null);
  const [order, setOrder] = useState<CardOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Fetch config on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  // Fetch pricing when amount changes
  useEffect(() => {
    if (config?.enabled && amount >= 5) {
      fetchPricing(amount);
    }
  }, [amount, config?.enabled]);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/cards/config');
      const data = await res.json();
      if (data.success) {
        setConfig(data.data);
        setAmount(data.data.defaultAmount || 5);
      }
    } catch (err) {
      console.error('Failed to fetch card config:', err);
    }
  };

  const fetchPricing = async (amt: number) => {
    try {
      const res = await fetch(`/api/cards/price?amount=${amt}`);
      const data = await res.json();
      if (data.success && data.data?.pricing) {
        // Map snake_case API response to camelCase frontend interface
        const apiPricing = data.data.pricing;
        setPricing({
          cardValue: apiPricing.card_value,
          starpayFeePercent: apiPricing.starpay_fee_percent,
          starpayFee: apiPricing.starpay_fee_usd,
          resellerMarkup: apiPricing.reseller_markup_usd,
          total: apiPricing.customer_price,
        });
      }
    } catch (err) {
      console.error('Failed to fetch pricing:', err);
    }
  };

  const createOrder = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/cards/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          cardType,
          email: email || undefined,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error);
      }

      setOrder(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    if (!order?.orderId) return;

    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/cards/order/status?orderId=${order.orderId}`);
      const data = await res.json();

      if (data.success) {
        setOrder(prev => prev ? { ...prev, status: data.data.status } : null);
      }
    } catch (err) {
      console.error('Failed to check status:', err);
    } finally {
      setCheckingStatus(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!config?.enabled) {
    return (
      <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Cash Out to Card</h2>
            <p className="text-sm text-gray-500">Convert winnings to prepaid cards</p>
          </div>
        </div>
        <p className="text-gray-500 text-sm">Card service not configured. Contact admin to enable.</p>
      </div>
    );
  }

  // Order created - show payment details
  if (order) {
    return (
      <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div>
            <h2 className="font-semibold text-white">Card Order Created</h2>
            <p className="text-sm text-gray-500">Send payment to receive your card</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Status</span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              order.status === 'completed' ? 'bg-green-500/20 text-green-400' :
              order.status === 'processing' ? 'bg-blue-500/20 text-blue-400' :
              order.status === 'failed' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>
              {order.status.toUpperCase()}
            </span>
          </div>

          {/* Payment Address */}
          <div className="bg-gray-800/50 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-2">Send exactly</p>
            <p className="text-2xl font-bold text-white mb-1">{order.payment.amountSol} SOL</p>
            <p className="text-gray-500 text-xs mb-3">(~${order.pricing.total.toFixed(2)} at ${order.payment.solPrice}/SOL)</p>

            <p className="text-gray-400 text-xs mb-2">To this address</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-white bg-gray-900 rounded px-3 py-2 overflow-hidden text-ellipsis">
                {order.payment.address}
              </code>
              <button
                onClick={() => copyToClipboard(order.payment.address)}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Card Details */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Card Value</span>
            <span className="text-white font-medium">${order.pricing.cardValue}</span>
          </div>

          {/* Expiry Warning */}
          <p className="text-yellow-500 text-xs text-center">
            Order expires at {new Date(order.expiresAt).toLocaleTimeString()}
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={checkStatus}
              disabled={checkingStatus}
              className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {checkingStatus ? 'Checking...' : 'Check Status'}
            </button>
            <button
              onClick={() => setOrder(null)}
              className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-colors"
            >
              New Order
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Order form
  return (
    <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-white">Cash Out to Card</h2>
          <p className="text-sm text-gray-500">Get a prepaid Visa or Mastercard</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Amount Selector */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Card Value (USD)</label>
          <div className="flex gap-2">
            {[5, 10, 25, 50, 100].map((amt) => (
              <button
                key={amt}
                onClick={() => setAmount(amt)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  amount === amt
                    ? 'bg-yellow-500 text-gray-900'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                ${amt}
              </button>
            ))}
          </div>
        </div>

        {/* Card Type */}
        <div>
          <label className="text-gray-400 text-sm mb-2 block">Card Type</label>
          <div className="flex gap-2">
            <button
              onClick={() => setCardType('visa')}
              className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${
                cardType === 'visa'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Visa
            </button>
            <button
              onClick={() => setCardType('mastercard')}
              className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${
                cardType === 'mastercard'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Mastercard
            </button>
          </div>
        </div>

        {/* Email (if not configured) */}
        {!config.emailConfigured && (
          <div>
            <label className="text-gray-400 text-sm mb-2 block">Email (for card delivery)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-yellow-500/50"
            />
          </div>
        )}

        {/* Pricing Summary */}
        {pricing && (
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Card Value</span>
              <span className="text-white">${pricing.cardValue}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Fee ({pricing.starpayFeePercent}%)</span>
              <span className="text-gray-400">${pricing.starpayFee.toFixed(2)}</span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between">
              <span className="text-white font-medium">Total</span>
              <span className="text-white font-medium">${pricing.total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={createOrder}
          disabled={loading || (!config.emailConfigured && !email)}
          className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 text-gray-900 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Creating Order...' : `Get $${amount} Card`}
        </button>

        <p className="text-gray-500 text-xs text-center">
          Powered by Starpay. Card delivered via email within minutes.
        </p>
      </div>
    </div>
  );
}
