/**
 * Encrypted Calls API Client
 *
 * Handles communication with the backend Calls service.
 * Integrates Inco encryption and Light Protocol on-chain storage.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

export interface EncryptedCall {
  id: string;
  marketId: string;
  userWallet: string;
  predictionHash: string;
  timestamp: number;
  revealCondition: 'market_resolution' | 'payment' | 'both';
  revealPrice: number;
  revealPriceSOL: string;
  status: 'encrypted' | 'revealed' | 'expired';
  revealedPrediction?: string;
  revealedAt?: number;
  revealedBy?: string;
  onChain?: {
    txSignature: string;
    explorerUrl: string;
    network: 'devnet' | 'mainnet';
    verified: boolean;
  };
}

export interface CallsStatus {
  enabled: boolean;
  onChain: boolean;
  network: string;
  encryption: string;
  storage: string;
  paymentAddress?: string;
  totalCalls: number;
  encryptedCalls: number;
  revealedCalls: number;
  uniqueMarkets: number;
  uniqueUsers: number;
  onChainVerified: number;
  defaultRevealPrice: string;
  features: string[];
}

export interface PaymentInfo {
  callId: string;
  paymentAddress: string;
  requiredAmount: number;
  requiredAmountSOL: number;
  requiredAmountDisplay: string;
  instructions: string[];
  network: string;
}

export interface CreateCallResponse {
  success: boolean;
  data?: {
    callId: string;
    marketId: string;
    status: string;
    predictionHash: string;
    revealCondition: string;
    revealPrice: number;
    revealPriceSOL: string;
    timestamp: number;
    onChain: {
      txSignature: string;
      explorerUrl: string;
      network: string;
      verified: boolean;
    };
    message: string;
  };
  error?: string;
}

/**
 * Get calls service status
 */
export async function getCallsStatus(): Promise<{ success: boolean; data?: CallsStatus; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/calls/status`);
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Create an encrypted call (prediction)
 */
export async function createCall(
  marketId: string,
  prediction: string,
  userWallet: string,
  revealCondition: 'market_resolution' | 'payment' | 'both' = 'both'
): Promise<CreateCallResponse> {
  try {
    const res = await fetch(`${API_URL}/api/calls/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketId,
        prediction,
        userWallet,
        revealCondition,
      }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get calls for a specific market
 */
export async function getCallsForMarket(marketId: string): Promise<{
  success: boolean;
  data?: {
    marketId: string;
    resolved: boolean;
    outcome?: string;
    resolvedAt?: number;
    calls: EncryptedCall[];
    totalCalls: number;
  };
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/calls/market/${encodeURIComponent(marketId)}`);
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get calls by user wallet
 */
export async function getCallsByUser(wallet: string): Promise<{
  success: boolean;
  data?: {
    userWallet: string;
    calls: EncryptedCall[];
    totalCalls: number;
  };
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/calls/user/${encodeURIComponent(wallet)}`);
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get a specific call by ID
 */
export async function getCall(callId: string): Promise<{
  success: boolean;
  data?: EncryptedCall;
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/calls/${encodeURIComponent(callId)}`);
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get payment info for revealing a call
 */
export async function getPaymentInfo(callId: string): Promise<{
  success: boolean;
  data?: PaymentInfo;
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/calls/${encodeURIComponent(callId)}/payment-info`);
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Reveal a call with payment
 */
export async function revealCall(
  callId: string,
  payerWallet: string,
  paymentSignature: string
): Promise<{
  success: boolean;
  data?: {
    callId: string;
    revealedPrediction: string;
    revealedAt: number;
    revealedBy: string;
  };
  error?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/calls/${encodeURIComponent(callId)}/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payerWallet,
        paymentSignature,
      }),
    });
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * List all calls with pagination
 */
export async function listCalls(options?: {
  limit?: number;
  offset?: number;
  status?: 'encrypted' | 'revealed' | 'all';
  marketId?: string;
}): Promise<{
  success: boolean;
  data?: {
    calls: EncryptedCall[];
    total: number;
    limit: number;
    offset: number;
  };
  error?: string;
}> {
  try {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.status) params.set('status', options.status);
    if (options?.marketId) params.set('marketId', options.marketId);

    const res = await fetch(`${API_URL}/api/calls?${params.toString()}`);
    return await res.json();
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Format timestamp to relative time
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Truncate wallet address for display
 */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
