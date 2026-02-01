import { useState, useEffect } from 'react';

interface Market {
  id: string;
  ticker: string;
  title: string;
  description?: string;
  yesPrice: number;
  noPrice: number;
  volume24h?: number;
  liquidity?: number;
  status: string;
  expiryTime?: string;
}

interface MarketListProps {
  privacyMode: boolean;
}

const API_URL = import.meta.env.VITE_API_URL || '';

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

function formatTimeRemaining(expiryTime?: string): string | null {
  if (!expiryTime) return null;
  const expiry = new Date(expiryTime);
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();

  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return '<1h';
}

export function MarketList({ privacyMode }: MarketListProps) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [orderSide, setOrderSide] = useState<'yes' | 'no'>('yes');
  const [orderAmount, setOrderAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchMarkets();
  }, []);

  const fetchMarkets = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/markets/trending?limit=5`);
      const data = await res.json();
      if (data.success) {
        setMarkets(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch markets:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const openOrderModal = (market: Market, side: 'yes' | 'no') => {
    setSelectedMarket(market);
    setOrderSide(side);
    setOrderAmount('');
    setOrderResult(null);
  };

  const closeModal = () => {
    setSelectedMarket(null);
    setOrderAmount('');
    setOrderResult(null);
  };

  const submitOrder = async () => {
    if (!selectedMarket || !orderAmount) return;

    setSubmitting(true);
    setOrderResult(null);

    try {
      const res = await fetch(`${API_URL}/api/trading/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: selectedMarket.id,
          side: orderSide,
          amount: parseFloat(orderAmount),
          usePrivacy: privacyMode,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setOrderResult({
          success: true,
          message: `Order placed! ${data.data.shares?.toFixed(2) || ''} shares purchased.`,
        });
        setTimeout(() => {
          closeModal();
        }, 2000);
      } else {
        setOrderResult({
          success: false,
          message: data.error || 'Order failed',
        });
      }
    } catch (error: any) {
      setOrderResult({
        success: false,
        message: error.message || 'Failed to submit order',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Trending Markets</h2>
        </div>
        <div className="p-8">
          <div className="flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span className="text-gray-400">Loading markets...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="font-semibold text-white">Trending Markets</h2>
        <button
          onClick={() => fetchMarkets(true)}
          disabled={refreshing}
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1 disabled:opacity-50 transition-colors"
        >
          {refreshing ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Refreshing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </>
          )}
        </button>
      </div>

      {/* Markets List */}
      {markets.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-gray-400">No active markets found</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-800">
          {markets.map((market, index) => {
            const yesPercent = market.yesPrice;
            const timeRemaining = formatTimeRemaining(market.expiryTime);
            const isHighVolume = (market.volume24h || 0) > 100000;

            return (
              <div
                key={market.id}
                className="p-4 hover:bg-gray-800/50 transition-colors"
              >
                {/* Top Row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                    <span className="font-mono text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                      {market.ticker}
                    </span>
                    {isHighVolume && (
                      <span className="text-xs font-medium text-white bg-gray-700 px-2 py-1 rounded">
                        High Volume
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {market.volume24h !== undefined && (
                      <div className="flex items-center gap-1">
                        <span>Vol:</span>
                        <span className="font-mono text-gray-300">{formatVolume(market.volume24h)}</span>
                      </div>
                    )}
                    {timeRemaining && (
                      <div className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-mono">{timeRemaining}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Market Title */}
                <h3 className="text-sm font-medium text-white mb-3 leading-relaxed">
                  {market.title}
                </h3>

                {/* Probability Bar */}
                <div className="mb-4">
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
                    <div
                      className="bg-white transition-all duration-300"
                      style={{ width: `${yesPercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-gray-300 font-medium">Yes {yesPercent}%</span>
                    <span className="text-gray-500">No {market.noPrice}%</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => openOrderModal(market, 'yes')}
                    className="flex-1 py-2.5 bg-white text-gray-900 font-medium text-sm rounded hover:bg-gray-100 transition-colors"
                  >
                    Buy Yes @ {market.yesPrice}c
                  </button>
                  <button
                    onClick={() => openOrderModal(market, 'no')}
                    className="flex-1 py-2.5 bg-gray-800 text-white font-medium text-sm border border-gray-700 rounded hover:bg-gray-700 transition-colors"
                  >
                    Buy No @ {market.noPrice}c
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Order Modal */}
      {selectedMarket && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg shadow-lg max-w-md w-full overflow-hidden border border-gray-700">
            {/* Modal Header */}
            <div className={`px-6 py-4 ${orderSide === 'yes' ? 'bg-white' : 'bg-gray-800 border-b border-gray-700'}`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold text-lg ${orderSide === 'yes' ? 'text-gray-900' : 'text-white'}`}>
                  Buy {orderSide.toUpperCase()}
                </h3>
                <button
                  onClick={closeModal}
                  className={`${orderSide === 'yes' ? 'text-gray-400 hover:text-gray-900' : 'text-gray-400 hover:text-white'} text-2xl leading-none`}
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Market Info */}
              <div className="mb-4 pb-4 border-b border-gray-700">
                <span className="text-xs font-mono text-gray-500">
                  {selectedMarket.ticker}
                </span>
                <p className="text-sm font-medium text-white mt-1">
                  {selectedMarket.title}
                </p>
              </div>

              {/* Privacy Mode Notice */}
              {privacyMode && (
                <div className="bg-gray-800 border border-gray-700 p-3 mb-4 rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="text-sm font-medium text-white">Privacy Mode Active</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Order will be placed from an unlinkable trading wallet
                  </p>
                </div>
              )}

              {/* Price Display */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                  <span className="text-xs text-gray-400 block mb-1">Price per Share</span>
                  <span className="text-2xl font-semibold text-white">
                    {orderSide === 'yes' ? selectedMarket.yesPrice : selectedMarket.noPrice}c
                  </span>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                  <span className="text-xs text-gray-400 block mb-1">Max Payout</span>
                  <span className="text-2xl font-semibold text-white">$1.00</span>
                </div>
              </div>

              {/* Amount Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Investment Amount (USDC)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3 pl-8 bg-gray-800 border border-gray-700 rounded-lg font-mono text-lg text-white placeholder-gray-500 focus:border-white focus:ring-1 focus:ring-white"
                    min="1"
                    step="1"
                  />
                </div>
                <div className="flex gap-2 mt-2">
                  {[5, 10, 25, 50, 100].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setOrderAmount(amt.toString())}
                      className="flex-1 py-1.5 text-xs font-medium border border-gray-700 text-gray-300 hover:border-white hover:text-white rounded transition-colors"
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimate */}
              {orderAmount && parseFloat(orderAmount) > 0 && (
                <div className="bg-gray-800 p-4 rounded-lg mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">Estimated Shares:</span>
                    <span className="font-mono font-medium text-white">
                      {(parseFloat(orderAmount) / (orderSide === 'yes' ? selectedMarket.yesPrice : selectedMarket.noPrice) * 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-400">Potential Payout:</span>
                    <span className="font-mono font-medium text-white">
                      ${(parseFloat(orderAmount) / (orderSide === 'yes' ? selectedMarket.yesPrice : selectedMarket.noPrice) * 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t border-gray-700">
                    <span className="text-gray-400">Potential Profit:</span>
                    <span className="font-mono font-medium text-green-400">
                      +${((parseFloat(orderAmount) / (orderSide === 'yes' ? selectedMarket.yesPrice : selectedMarket.noPrice) * 100) - parseFloat(orderAmount)).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Result Message */}
              {orderResult && (
                <div className={`p-3 rounded-lg mb-4 ${
                  orderResult.success
                    ? 'bg-green-900/50 border border-green-700 text-green-400'
                    : 'bg-red-900/50 border border-red-700 text-red-400'
                }`}>
                  <p className="text-sm font-medium">{orderResult.message}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  disabled={submitting}
                  className="flex-1 py-3 font-medium border border-gray-600 text-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitOrder}
                  disabled={submitting || !orderAmount || parseFloat(orderAmount) <= 0}
                  className={`flex-1 py-3 font-medium rounded-lg disabled:opacity-50 transition-colors ${
                    orderSide === 'yes'
                      ? 'bg-white text-gray-900 hover:bg-gray-100'
                      : 'bg-gray-700 text-white hover:bg-gray-600'
                  }`}
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className={`w-4 h-4 border-2 ${orderSide === 'yes' ? 'border-gray-900' : 'border-white'} border-t-transparent rounded-full animate-spin`}></div>
                      Placing...
                    </span>
                  ) : (
                    `Confirm ${orderSide.toUpperCase()}`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
