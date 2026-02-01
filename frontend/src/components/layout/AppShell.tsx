import { ReactNode } from 'react';
import { ConnectButton } from '@phantom/react-sdk';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900/80 backdrop-blur-sm border-b border-gray-800/50 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-lg font-semibold text-white tracking-tight">
            Privacy Prediction Markets
          </span>
          <ConnectButton />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 bg-gray-900/50 mt-auto">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <p className="text-sm text-gray-500 text-center">
            Built on Solana
          </p>
        </div>
      </footer>
    </div>
  );
}
