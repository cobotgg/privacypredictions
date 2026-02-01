import axios from 'axios';
import { config } from '../config/env.js';

// Range Security API configuration
// Docs: https://docs.range.org/risk-api/risk/get-address-risk-score
const RANGE_API_URL = 'https://api.range.org/v1';

export type RiskLevel = 'low' | 'medium' | 'high' | 'severe';

export interface ScreeningResult {
  address: string;
  chain: string;
  riskLevel: RiskLevel;
  riskScore: number; // 0-100
  flags: string[];
  sanctions: boolean;
  mixerInteraction: boolean;
  illicitActivity: boolean;
  timestamp: string;
}

export interface TransactionScreening {
  txHash?: string;
  fromAddress: string;
  toAddress: string;
  fromRisk: ScreeningResult;
  toRisk: ScreeningResult;
  overallRisk: RiskLevel;
  recommendation: 'allow' | 'review' | 'block';
  reason?: string;
}

/**
 * Check if Range compliance is enabled
 */
export function isRangeEnabled(): boolean {
  return !!config.rangeApiKey;
}

/**
 * Screen a wallet address for compliance
 */
export async function screenAddress(
  address: string,
  chain: 'solana' | 'ethereum' = 'solana'
): Promise<ScreeningResult> {
  if (!isRangeEnabled()) {
    // Return mock low-risk result when not configured
    return {
      address,
      chain,
      riskLevel: 'low',
      riskScore: 0,
      flags: [],
      sanctions: false,
      mixerInteraction: false,
      illicitActivity: false,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // Use GET request with query parameters as per Range API docs
    // https://docs.range.org/risk-api/risk/get-address-risk-score
    const response = await axios.get(
      `${RANGE_API_URL}/risk/address`,
      {
        params: {
          address,
          network: chain,
        },
        headers: {
          'Authorization': `Bearer ${config.rangeApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );

    // Map Range API response to our internal format
    const data = response.data;
    const riskScore = data.riskScore || 0; // 1-10 scale
    const normalizedScore = riskScore * 10; // Convert to 0-100

    // Map risk level from score
    let riskLevel: RiskLevel = 'low';
    if (riskScore >= 8) riskLevel = 'severe';
    else if (riskScore >= 6) riskLevel = 'high';
    else if (riskScore >= 4) riskLevel = 'medium';

    // Check for malicious activity
    const hasMalicious = data.maliciousAddressesFound?.length > 0;
    const hasSanctions = data.attribution?.sanctioned === true;

    return {
      address,
      chain,
      riskLevel,
      riskScore: normalizedScore,
      flags: data.maliciousAddressesFound || [],
      sanctions: hasSanctions,
      mixerInteraction: data.reasoning?.toLowerCase().includes('mixer') || false,
      illicitActivity: hasMalicious,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Range API error:', error.response?.status, error.response?.data);
      throw new Error(error.response?.data?.message || `Range API error: ${error.response?.status}`);
    }
    throw error;
  }
}

/**
 * Screen a transaction for compliance
 */
export async function screenTransaction(
  fromAddress: string,
  toAddress: string,
  amount: number,
  token: string,
  chain: 'solana' | 'ethereum' = 'solana'
): Promise<TransactionScreening> {
  if (!isRangeEnabled()) {
    // Return mock passing result when not configured
    const mockResult: ScreeningResult = {
      address: '',
      chain,
      riskLevel: 'low',
      riskScore: 0,
      flags: [],
      sanctions: false,
      mixerInteraction: false,
      illicitActivity: false,
      timestamp: new Date().toISOString(),
    };

    return {
      fromAddress,
      toAddress,
      fromRisk: { ...mockResult, address: fromAddress },
      toRisk: { ...mockResult, address: toAddress },
      overallRisk: 'low',
      recommendation: 'allow',
    };
  }

  try {
    // Screen both addresses in parallel
    const [fromRisk, toRisk] = await Promise.all([
      screenAddress(fromAddress, chain),
      screenAddress(toAddress, chain),
    ]);

    // Determine overall risk
    const overallRisk = determineOverallRisk(fromRisk.riskLevel, toRisk.riskLevel);
    const recommendation = determineRecommendation(overallRisk, fromRisk, toRisk);

    return {
      fromAddress,
      toAddress,
      fromRisk,
      toRisk,
      overallRisk,
      recommendation: recommendation.action,
      reason: recommendation.reason,
    };
  } catch (error) {
    console.error('Transaction screening failed:', error);
    // Fail open with warning when API is unavailable
    return {
      fromAddress,
      toAddress,
      fromRisk: createUnknownRisk(fromAddress, chain),
      toRisk: createUnknownRisk(toAddress, chain),
      overallRisk: 'medium',
      recommendation: 'review',
      reason: 'Compliance service unavailable - manual review recommended',
    };
  }
}

/**
 * Determine the overall risk level from two risk levels
 */
function determineOverallRisk(risk1: RiskLevel, risk2: RiskLevel): RiskLevel {
  const riskOrder: RiskLevel[] = ['low', 'medium', 'high', 'severe'];
  const index1 = riskOrder.indexOf(risk1);
  const index2 = riskOrder.indexOf(risk2);
  return riskOrder[Math.max(index1, index2)];
}

/**
 * Determine recommendation based on risk analysis
 */
function determineRecommendation(
  overallRisk: RiskLevel,
  fromRisk: ScreeningResult,
  toRisk: ScreeningResult
): { action: 'allow' | 'review' | 'block'; reason?: string } {
  // Block sanctioned addresses
  if (fromRisk.sanctions || toRisk.sanctions) {
    return {
      action: 'block',
      reason: 'Sanctioned address detected',
    };
  }

  // Block severe risk
  if (overallRisk === 'severe') {
    return {
      action: 'block',
      reason: 'Severe risk level detected',
    };
  }

  // Review high risk
  if (overallRisk === 'high') {
    const reasons: string[] = [];
    if (fromRisk.mixerInteraction || toRisk.mixerInteraction) {
      reasons.push('mixer interaction');
    }
    if (fromRisk.illicitActivity || toRisk.illicitActivity) {
      reasons.push('illicit activity');
    }
    return {
      action: 'review',
      reason: reasons.length > 0 ? `High risk due to: ${reasons.join(', ')}` : 'High risk score',
    };
  }

  // Review medium risk
  if (overallRisk === 'medium') {
    return {
      action: 'review',
      reason: 'Medium risk - manual review recommended',
    };
  }

  // Allow low risk
  return { action: 'allow' };
}

/**
 * Create an unknown risk result for unavailable data
 */
function createUnknownRisk(address: string, chain: string): ScreeningResult {
  return {
    address,
    chain,
    riskLevel: 'medium',
    riskScore: 50,
    flags: ['UNKNOWN'],
    sanctions: false,
    mixerInteraction: false,
    illicitActivity: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get risk color for UI display
 */
export function getRiskColor(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'low':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'high':
      return 'orange';
    case 'severe':
      return 'red';
    default:
      return 'gray';
  }
}

/**
 * Check if a transaction should be blocked
 */
export function shouldBlockTransaction(screening: TransactionScreening): boolean {
  return screening.recommendation === 'block';
}

/**
 * Check if a transaction needs review
 */
export function needsReview(screening: TransactionScreening): boolean {
  return screening.recommendation === 'review';
}
