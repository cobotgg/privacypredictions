
interface MainWalletProps {
  address: string;
  solBalance: number | null;
  usdcBalance: number | null;
  onDisconnect: () => void;
}

export function MainWallet({ address, solBalance, usdcBalance, onDisconnect }: MainWalletProps) {
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '';

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Your Wallet
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-gray-200 font-mono text-sm">{shortAddress}</span>
            <button
              onClick={copyAddress}
              className="text-gray-500 hover:text-white transition-colors"
              title="Copy address"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
        <button
          onClick={onDisconnect}
          className="text-gray-500 hover:text-white text-sm font-medium transition-colors"
        >
          Disconnect
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-800">
        <div>
          <span className="text-gray-500 text-xs uppercase tracking-wide">SOL</span>
          <p className="text-2xl font-semibold text-white font-mono mt-1">
            {solBalance !== null ? solBalance.toFixed(4) : '...'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 text-xs uppercase tracking-wide">USDC</span>
          <p className="text-2xl font-semibold text-white font-mono mt-1">
            ${usdcBalance !== null ? usdcBalance.toFixed(2) : '...'}
          </p>
        </div>
      </div>
    </div>
  );
}
