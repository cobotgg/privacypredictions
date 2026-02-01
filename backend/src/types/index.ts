// Wallet Types
export interface WalletInfo {
  address: string;
  solBalance: number;
  usdcBalance: number;
}

export interface TradingWallet {
  id: string;
  address: string;
  privateKey: string;  // Base58 encoded
  createdAt: string;
  label?: string;
  solBalance?: number;
  usdcBalance?: number;
}

// Market Types
export interface Market {
  id: string;
  ticker: string;
  title: string;
  description?: string;
  status: 'active' | 'closed' | 'determined' | 'finalized';
  yesPrice: number;      // 0-100
  noPrice: number;       // 0-100
  volume24h?: number;
  liquidity?: number;
  expiryTime?: string;
  yesMint?: string;
  noMint?: string;
}

export interface MarketQuote {
  marketId: string;
  side: 'yes' | 'no';
  amount: number;        // USDC
  shares: number;        // Expected shares
  price: number;         // Price per share
  fee: number;           // Fee in USDC
  slippage: number;      // Slippage in bps
}

// Trading Types
export interface Order {
  marketId: string;
  side: 'yes' | 'no';
  amount: number;        // USDC amount
  usePrivacy: boolean;
  walletId?: string;     // Trading wallet ID (if privacy mode)
}

export interface OrderResult {
  success: boolean;
  signature?: string;
  shares?: number;
  error?: string;
  walletAddress?: string;
  privacyProtected?: boolean;
  positionMint?: string; // Position token mint (for closing position later)
  proceeds?: number; // USDC proceeds when closing a position
}

export interface Position {
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

// Transfer Types
export interface TransferRequest {
  fromWalletId?: string;   // null = main wallet
  toWalletId?: string;     // null = main wallet
  toAddress?: string;      // Direct address
  amount: number;
  token: 'sol' | 'usdc';
  usePrivacyPool?: boolean;
}

export interface TransferResult {
  success: boolean;
  signature?: string;
  error?: string;
  pending?: boolean;  // True if transaction sent but confirmation timed out
}

// Privacy Types
export interface PrivacyDeposit {
  id: string;
  amount: number;
  token: 'sol' | 'usdc';
  status: 'pending' | 'confirmed' | 'failed';
  depositSignature?: string;
  withdrawSignature?: string;
  createdAt: string;
}

export interface PrivacyProof {
  id: string;
  batchId: string;
  proof: string;
  verified: boolean;
  createdAt: string;
}

// AI Types
export interface AIAnalysis {
  marketId: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
  suggestedSide?: 'yes' | 'no';
  suggestedAmount?: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
