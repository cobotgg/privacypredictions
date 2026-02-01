import { PublicKey } from '@solana/web3.js';
import { InvalidAddressError, NetworkError } from './errors.js';

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function validateSolanaAddress(address: string): void {
  if (!isValidSolanaAddress(address)) {
    throw new InvalidAddressError(address);
  }
}

export function generateNonce(): number {
  return Math.floor(Date.now() / 1000);
}

export async function makeHttpRequest<T>(
  url: string,
  method: string,
  apiKey: string | undefined,
  body?: any,
  debug: boolean = false
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  } = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  if (debug) {
    console.log(`[ShadowWire SDK] ${method} ${url}`);
    if (body) {
      console.log('[ShadowWire SDK] Request body:', body);
    }
  }

  try {
    const response = await (globalThis as any).fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || `HTTP ${response.status}: ${response.statusText}`;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
      }
      
      throw new NetworkError(errorMessage);
    }

    const data = await response.json();
    
    if (debug) {
      console.log('[ShadowWire SDK] Response:', data);
    }
    
    return data;
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error;
    }
    
    if (error instanceof Error) {
      throw new NetworkError(`Request failed: ${error.message}`);
    }
    
    throw new NetworkError('Request failed with unknown error');
  }
}

