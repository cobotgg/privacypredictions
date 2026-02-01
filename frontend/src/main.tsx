import React, { createContext, useContext, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import {
  PhantomProvider,
  AddressType,
  darkTheme,
} from '@phantom/react-sdk';
import { Connection } from '@solana/web3.js';
import App from './App';
import './index.css';

// Solana RPC endpoint
const endpoint = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Connection Context for Solana RPC calls
const ConnectionContext = createContext<Connection | null>(null);

export function useConnection() {
  const connection = useContext(ConnectionContext);
  if (!connection) {
    throw new Error('useConnection must be used within ConnectionProvider');
  }
  return { connection };
}

function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const connection = useMemo(() => new Connection(endpoint, 'confirmed'), []);
  return (
    <ConnectionContext.Provider value={connection}>
      {children}
    </ConnectionContext.Provider>
  );
}

// Phantom SDK configuration
const phantomConfig = {
  // Use injected provider (Phantom extension) - no appId needed for extension-only
  providers: ['injected'] as ('google' | 'apple' | 'phantom' | 'injected')[],
  addressTypes: [AddressType.solana],
  // Optional: Add appId for embedded wallet support
  // appId: 'your-phantom-app-id',
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PhantomProvider
      config={phantomConfig}
      theme={darkTheme}
      appName="Privacy Prediction Markets"
    >
      <ConnectionProvider>
        <App />
      </ConnectionProvider>
    </PhantomProvider>
  </React.StrictMode>
);
