import { useEffect, useState } from 'react';
import { usePhantom, useModal, AddressType } from '@phantom/react-sdk';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { useConnection } from './main';
import { AppShell } from './components/layout/AppShell';
import { MainWallet } from './components/wallet/MainWallet';
import { TradingWalletList } from './components/wallet/TradingWalletList';
import { MarketList } from './components/market/MarketList';
import { PositionList } from './components/position/PositionList';
import { MarketResearchAnalyst } from './components/ai/MarketResearchAnalyst';
import { CardOrder } from './components/cards/CardOrder';
import { TransferMethodSelector } from './components/transfer/TransferMethodSelector';

function WelcomeScreen() {
  const { open } = useModal();

  return (
    <div className="max-w-3xl mx-auto px-4">
      {/* Hero */}
      <div className="text-center py-16 md:py-24">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight leading-tight">
          Bet on Outcomes,<br />
          <span className="text-gray-400">Stay Anonymous</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-lg mx-auto leading-relaxed mb-10">
          Participate in prediction markets with wallet privacy.
          Your positions remain unlinkable to your main wallet through zero-knowledge proofs.
        </p>
        <button
          onClick={open}
          className="bg-white text-gray-900 font-semibold px-8 py-4 text-base rounded-xl hover:bg-gray-100 transition-all hover:scale-105 shadow-lg shadow-white/10"
        >
          Get Started
        </button>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-12">
        <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 p-6 rounded-2xl border border-gray-800/50 hover:border-gray-700/50 transition-colors">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-purple-600/10 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          </div>
          <h3 className="font-semibold text-white mb-2">Link Wallet</h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            Sign in with your Phantom wallet to access the platform.
          </p>
        </div>

        <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 p-6 rounded-2xl border border-gray-800/50 hover:border-gray-700/50 transition-colors">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h3 className="font-semibold text-white mb-2">Generate Stealth Wallets</h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            Spawn isolated wallets for each trade session.
          </p>
        </div>

        <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 p-6 rounded-2xl border border-gray-800/50 hover:border-gray-700/50 transition-colors">
          <div className="w-12 h-12 bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h3 className="font-semibold text-white mb-2">Trade Anonymously</h3>
          <p className="text-sm text-gray-500 leading-relaxed">
            Place bets on market outcomes without exposing your identity.
          </p>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const { addresses, sdk } = usePhantom();
  const { connection } = useConnection();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [activeSection, setActiveSection] = useState<'markets' | 'positions' | 'transfer' | 'cashout' | 'advanced'>('markets');

  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  // Get Solana address from connected wallet
  const solanaAddress = addresses.find(addr => addr.addressType === AddressType.solana)?.address;

  useEffect(() => {
    if (!solanaAddress) return;

    const fetchBalances = async () => {
      try {
        const publicKey = new PublicKey(solanaAddress);
        const balance = await connection.getBalance(publicKey);
        setSolBalance(balance / LAMPORTS_PER_SOL);

        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(USDC_MINT),
        });

        if (tokenAccounts.value.length > 0) {
          setUsdcBalance(tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount);
        } else {
          setUsdcBalance(0);
        }
      } catch (error) {
        console.error('Failed to fetch balances:', error);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 15000);
    return () => clearInterval(interval);
  }, [solanaAddress, connection]);

  const handleDisconnect = async () => {
    if (sdk) {
      await sdk.disconnect();
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Wallet */}
      <MainWallet
        address={solanaAddress || ''}
        solBalance={solBalance}
        usdcBalance={usdcBalance}
        onDisconnect={handleDisconnect}
      />

      {/* Stealth Wallets Section */}
      <div className="bg-gradient-to-b from-gray-900 to-gray-900/50 rounded-2xl border border-gray-800/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-white">Stealth Wallets</h2>
              <p className="text-sm text-gray-500">Isolated wallets for anonymous trading</p>
            </div>
          </div>
          <button
            onClick={() => setPrivacyMode(!privacyMode)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              privacyMode ? 'bg-blue-500' : 'bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${
                privacyMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {privacyMode && <TradingWalletList />}
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 bg-gray-900 p-1 rounded-lg w-fit border border-gray-800">
        {[
          { key: 'markets', label: 'Markets' },
          { key: 'positions', label: 'Positions' },
          { key: 'transfer', label: 'Transfer' },
          { key: 'cashout', label: 'Cash Out' },
          { key: 'advanced', label: 'AI Agent' },
        ].map((section) => (
          <button
            key={section.key}
            onClick={() => setActiveSection(section.key as typeof activeSection)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeSection === section.key
                ? 'bg-white text-gray-900'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      {/* Section Content */}
      {activeSection === 'markets' && <MarketList privacyMode={privacyMode} />}
      {activeSection === 'positions' && <PositionList />}
      {activeSection === 'transfer' && <TransferMethodSelector />}
      {activeSection === 'cashout' && <CardOrder />}
      {activeSection === 'advanced' && (
        <div className="space-y-6">
          <MarketResearchAnalyst />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { isConnected, isLoading } = usePhantom();

  // Show loading state while SDK initializes
  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-gray-400">Loading...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {isConnected ? <Dashboard /> : <WelcomeScreen />}
    </AppShell>
  );
}
