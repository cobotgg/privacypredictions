import { useState, useEffect } from 'react';

interface Position {
  id: string;
  marketId: string;
  marketTitle: string;
  side: 'yes' | 'no';
  shares: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  walletAddress: string;
  mint: string;
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function PositionList() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchPositions = async () => {
    try {
      const res = await fetch(`${API_URL}/api/trading/positions`);
      const data = await res.json();
      if (data.success) {
        setPositions(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    } finally {
      setLoading(false);
    }
  };

  const closePosition = async (position: Position) => {
    setClosing(position.id);
    try {
      const res = await fetch(`${API_URL}/api/trading/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionMint: position.mint,
          marketId: position.marketId,
          side: position.side,
          shares: position.shares,
          walletAddress: position.walletAddress,
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchPositions();
      }
    } catch (error) {
      console.error('Failed to close position:', error);
    } finally {
      setClosing(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="text-center py-8 text-gray-400">Loading positions...</div>
      </div>
    );
  }

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const totalValue = positions.reduce((sum, p) => sum + p.shares * p.currentPrice / 100, 0);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">Your Positions</h2>
        <button
          onClick={fetchPositions}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Portfolio Summary */}
      {positions.length > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-800 rounded-lg">
          <div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total Value</span>
            <p className="text-2xl font-semibold text-white font-mono mt-1">${totalValue.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total P&L</span>
            <p className={`text-2xl font-semibold font-mono mt-1 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {positions.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-700 rounded-lg">
          <p className="text-gray-400 mb-2">No open positions</p>
          <p className="text-sm text-gray-500">
            Go to Markets tab to place your first trade
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map((position) => (
            <div
              key={position.id}
              className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                      position.side === 'yes'
                        ? 'bg-white text-gray-900'
                        : 'bg-gray-700 text-gray-300'
                    }`}>
                      {position.side.toUpperCase()}
                    </span>
                    <span className="text-xs font-mono text-gray-500">
                      {position.shares.toFixed(2)} shares
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white line-clamp-2 mb-3">
                    {position.marketTitle}
                  </p>

                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">Entry</span>
                      <p className="font-mono text-gray-300 mt-0.5">{position.entryPrice}c</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Current</span>
                      <p className="font-mono text-gray-300 mt-0.5">{position.currentPrice}c</p>
                    </div>
                    <div>
                      <span className="text-gray-500">P&L</span>
                      <p className={`font-mono font-medium mt-0.5 ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => closePosition(position)}
                    disabled={closing === position.id}
                    className="px-4 py-2 bg-white text-gray-900 font-medium text-xs rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
                  >
                    {closing === position.id ? 'Closing...' : 'Sell'}
                  </button>
                  <a
                    href={`https://solscan.io/account/${position.walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-center text-gray-500 hover:text-white transition-colors"
                  >
                    View Wallet
                  </a>
                </div>
              </div>

              {/* Privacy indicator */}
              {position.walletAddress.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Wallet:</span>
                    <span className="font-mono">
                      {position.walletAddress.slice(0, 4)}...{position.walletAddress.slice(-4)}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-gray-400">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span className="font-medium">Private</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
