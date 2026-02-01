import { useState, useEffect } from 'react';

interface ScreeningResult {
  address: string;
  riskLevel: 'low' | 'medium' | 'high' | 'severe';
  riskScore: number;
  flags: string[];
  sanctions: boolean;
  color: string;
}

interface ComplianceBadgeProps {
  address: string;
  showDetails?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const RISK_COLORS = {
  low: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  severe: 'bg-red-500/20 text-red-400 border-red-500/30',
  unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const RISK_ICONS = {
  low: '✓',
  medium: '⚠',
  high: '⚡',
  severe: '✕',
  unknown: '?',
};

export function ComplianceBadge({ address, showDetails = false, size = 'sm' }: ComplianceBadgeProps) {
  const [screening, setScreening] = useState<ScreeningResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (address) {
      screenAddress();
    }
  }, [address]);

  const screenAddress = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/compliance/screen/address?address=${address}`);
      const data = await res.json();
      if (data.success) {
        setScreening(data.data);
      }
    } catch (err) {
      console.error('Failed to screen address:', err);
    } finally {
      setLoading(false);
    }
  };

  const riskLevel = screening?.riskLevel || 'unknown';
  const colorClass = RISK_COLORS[riskLevel];
  const icon = RISK_ICONS[riskLevel];

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border ${RISK_COLORS.unknown} ${sizeClasses[size]}`}>
        <span className="animate-pulse">●</span>
        <span>Checking...</span>
      </span>
    );
  }

  if (!showDetails) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border ${colorClass} ${sizeClasses[size]} cursor-pointer`}
        onClick={() => setExpanded(!expanded)}
        title={`Risk: ${riskLevel.toUpperCase()} (${screening?.riskScore || 0}%)`}
      >
        <span>{icon}</span>
        <span className="capitalize">{riskLevel}</span>
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={`inline-flex items-center gap-2 rounded-full border ${colorClass} ${sizeClasses[size]} cursor-pointer`}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{icon}</span>
        <span className="capitalize">{riskLevel} Risk</span>
        <span className="opacity-60">({screening?.riskScore || 0}%)</span>
      </div>

      {expanded && screening && (
        <div className="bg-gray-800/50 rounded-lg p-3 text-sm space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-400">Risk Score</span>
            <span className="text-white">{screening.riskScore}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Sanctioned</span>
            <span className={screening.sanctions ? 'text-red-400' : 'text-green-400'}>
              {screening.sanctions ? 'Yes' : 'No'}
            </span>
          </div>
          {screening.flags.length > 0 && (
            <div>
              <span className="text-gray-400 block mb-1">Flags</span>
              <div className="flex flex-wrap gap-1">
                {screening.flags.map((flag, i) => (
                  <span key={i} className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs">
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TransactionComplianceProps {
  fromAddress: string;
  toAddress: string;
  onScreeningComplete?: (recommendation: 'allow' | 'review' | 'block') => void;
}

export function TransactionCompliance({ fromAddress, toAddress, onScreeningComplete }: TransactionComplianceProps) {
  const [screening, setScreening] = useState<{
    overallRisk: 'low' | 'medium' | 'high' | 'severe';
    recommendation: 'allow' | 'review' | 'block';
    reason?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (fromAddress && toAddress) {
      screenTransaction();
    }
  }, [fromAddress, toAddress]);

  const screenTransaction = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/compliance/screen/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAddress, toAddress }),
      });
      const data = await res.json();
      if (data.success) {
        setScreening(data.data);
        onScreeningComplete?.(data.data.recommendation);
      }
    } catch (err) {
      console.error('Failed to screen transaction:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <span className="animate-spin">◌</span>
        <span>Screening transaction...</span>
      </div>
    );
  }

  if (!screening) return null;

  const recommendationColors = {
    allow: 'bg-green-500/20 text-green-400 border-green-500/30',
    review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    block: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  const recommendationIcons = {
    allow: '✓',
    review: '⚠',
    block: '✕',
  };

  return (
    <div className={`rounded-lg border p-3 ${recommendationColors[screening.recommendation]}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{recommendationIcons[screening.recommendation]}</span>
        <div>
          <p className="font-medium capitalize">
            {screening.recommendation === 'allow' && 'Transaction Approved'}
            {screening.recommendation === 'review' && 'Manual Review Required'}
            {screening.recommendation === 'block' && 'Transaction Blocked'}
          </p>
          {screening.reason && (
            <p className="text-sm opacity-80">{screening.reason}</p>
          )}
        </div>
      </div>
    </div>
  );
}
