import { useState, useEffect, useRef } from 'react';
import { encryptResearchQuery, getEncryptionStatus, type EncryptedResearchQuery } from '../../lib/arcium-encrypt';

interface Market {
  id: string;
  ticker: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  volume24h?: number;
  status: string;
}

interface ZKProof {
  proofId: string;
  type: string;
  queryHash: string;
  responseHash: string;
  merkleRoot: string;
  timestamp: string;
  verificationKey: string;
  verificationStatus: string;
  raw?: {
    proofId: string;
    publicInputs: {
      queryCommitment: string;
      responseCommitment: string;
      marketId: string;
      timestamp: string;
      modelId: string;
    };
    merkleRoot: string;
    proof: string;
    verificationKey: string;
  };
}

interface ResearchMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  privacy?: {
    encrypted: boolean;
    encryptionMethod: string | null;
    queryHash: string | null;
  };
  zkProof?: ZKProof;
}

interface AIStatus {
  available: boolean;
  model: string;
  privacy?: {
    arciumEncryption: boolean;
    noirProofs: boolean;
    mxeKeyId: string;
  };
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function MarketResearchAnalyst() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [showProof, setShowProof] = useState<string | null>(null);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const encryptionStatus = getEncryptionStatus();

  useEffect(() => {
    fetchMarkets();
    checkAIStatus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchMarkets = async () => {
    try {
      const res = await fetch(`${API_URL}/api/markets/trending?limit=10`);
      const data = await res.json();
      if (data.success) setMarkets(data.data);
    } catch (error) {
      console.error('Failed to fetch markets:', error);
    }
  };

  const checkAIStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/ai/status`);
      const data = await res.json();
      if (data.success) setAiStatus(data.data);
    } catch (error) {
      console.error('Failed to check AI status:', error);
    }
  };

  const handleMarketSelect = (market: Market) => {
    setSelectedMarket(market);
    setMessages([{
      id: `system-${Date.now()}`,
      role: 'system',
      content: `Selected market: ${market.title}\n\nCurrent prices: YES @ ${market.yesPrice}¢ | NO @ ${market.noPrice}¢\n\nAsk me anything about this market - analysis, risks, recommendations, or any questions you have.\n\nPrivacy Mode: ${privacyEnabled ? 'ON - Your questions are encrypted with Arcium' : 'OFF'}`,
      timestamp: new Date().toISOString(),
    }]);
  };

  const askQuestion = async () => {
    if (!question.trim() || !selectedMarket || loading) return;

    const timestamp = Date.now();

    // Encrypt the query if privacy is enabled
    let encryptedQuery: EncryptedResearchQuery | null = null;
    if (privacyEnabled) {
      try {
        encryptedQuery = await encryptResearchQuery({
          marketId: selectedMarket.id,
          question: question,
          timestamp,
        });
        console.log('Query encrypted with Arcium:', encryptedQuery.queryHash);
      } catch (error) {
        console.error('Encryption failed, sending unencrypted:', error);
      }
    }

    const userMessage: ResearchMessage = {
      id: `user-${timestamp}`,
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
      privacy: encryptedQuery ? {
        encrypted: true,
        encryptionMethod: 'Arcium x25519 ECDH',
        queryHash: encryptedQuery.queryHash,
      } : undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    setQuestion('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/ai/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: selectedMarket.id,
          question: question,
          marketContext: {
            title: selectedMarket.title,
            yesPrice: selectedMarket.yesPrice,
            noPrice: selectedMarket.noPrice,
            volume: selectedMarket.volume24h,
          },
          encrypted: encryptedQuery,
          generateProof: true,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const assistantMessage: ResearchMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.data.response,
          timestamp: new Date().toISOString(),
          privacy: data.data.privacy,
          zkProof: data.data.zkProof,
        };

        setMessages(prev => [...prev, assistantMessage]);
      } else {
        const errorMessage: ResearchMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${data.error || 'Failed to get response'}`,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (error: any) {
      const errorMessage: ResearchMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to connect to AI service'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'Should I buy YES or NO?',
    'What are the main risks?',
    'Analyze the current pricing',
    'What factors could change the outcome?',
    'Is this market fairly priced?',
  ];

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="bg-white text-gray-900 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <div>
              <h2 className="font-semibold">
                Market Research Analyst
              </h2>
              <p className="text-sm text-gray-500">
                AI-powered analysis with Arcium encryption & Noir ZK proofs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Privacy Toggle */}
            <button
              onClick={() => setPrivacyEnabled(!privacyEnabled)}
              className="flex items-center gap-2"
            >
              <span className="text-sm text-gray-500">{privacyEnabled ? 'Private' : 'Public'}</span>
              <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                privacyEnabled ? 'bg-gray-900' : 'bg-gray-300'
              }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                  privacyEnabled ? 'translate-x-6 bg-white' : 'translate-x-1 bg-gray-500'
                }`} />
              </div>
            </button>
            {/* AI Status */}
            {aiStatus && (
              <div className={`flex items-center gap-2 ${aiStatus.available ? 'text-green-600' : 'text-red-600'}`}>
                <span className={`w-2 h-2 rounded-full ${aiStatus.available ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                <span className="text-xs font-mono">{aiStatus.model}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Privacy Status Banner */}
        {privacyEnabled && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-6">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Privacy Mode Active</p>
                <p className="text-xs text-gray-400">
                  Questions encrypted with <strong>Arcium x25519 ECDH</strong> •
                  Responses verified with <strong>Noir ZK Proofs</strong>
                </p>
              </div>
              <div className="text-xs font-mono text-gray-500">
                MXE: {encryptionStatus.mxeKeyId}
              </div>
            </div>
          </div>
        )}

        {/* AI Status Warning */}
        {aiStatus && !aiStatus.available && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-400 font-medium">AI Not Configured</p>
            <p className="text-sm text-gray-400 mt-1">
              Set OPENAI_API_KEY in backend/.env to enable AI research
            </p>
          </div>
        )}

        {/* Market Selection */}
        {!selectedMarket ? (
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-gray-300">
              Select a Market to Analyze
            </h3>
            <div className="grid gap-3">
              {markets.map((market) => (
                <button
                  key={market.id}
                  onClick={() => handleMarketSelect(market)}
                  className="w-full text-left p-4 border border-gray-700 rounded-lg hover:border-gray-500 hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-xs text-gray-500 block mb-1">
                        {market.ticker}
                      </span>
                      <span className="font-medium text-sm text-white">
                        {market.title}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="flex gap-3 text-sm">
                        <span className="font-medium text-white">YES {market.yesPrice}¢</span>
                        <span className="text-gray-400">NO {market.noPrice}¢</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selected Market Header */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-700">
              <div>
                <span className="font-mono text-xs text-gray-500 block">
                  {selectedMarket.ticker}
                </span>
                <h3 className="font-semibold text-white">
                  {selectedMarket.title}
                </h3>
              </div>
              <button
                onClick={() => {
                  setSelectedMarket(null);
                  setMessages([]);
                }}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Change Market
              </button>
            </div>

            {/* Chat Messages */}
            <div className="border border-gray-700 bg-gray-800 rounded-lg min-h-[300px] max-h-[500px] overflow-y-auto">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-4 border-b border-gray-700 last:border-b-0 ${
                    msg.role === 'user' ? 'bg-gray-900' :
                    msg.role === 'system' ? 'bg-gray-800' : 'bg-gray-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                      {msg.role === 'user' ? (
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      ) : msg.role === 'system' ? (
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-400">
                            {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'AI Analyst'}
                          </span>
                          {msg.privacy?.encrypted && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-white text-gray-900 rounded">
                              Encrypted
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 font-mono">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-gray-300">{msg.content}</p>

                      {/* ZK Proof Verification (for assistant messages) */}
                      {msg.zkProof && (
                        <div className="mt-3">
                          <button
                            onClick={() => setShowProof(showProof === msg.id ? null : msg.id)}
                            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            <span className="underline">
                              {showProof === msg.id ? 'Hide' : 'Show'} Noir ZK Proof
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              msg.zkProof.verificationStatus.includes('✓')
                                ? 'bg-green-900/50 text-green-400'
                                : 'bg-gray-700 text-gray-400'
                            }`}>
                              {msg.zkProof.verificationStatus}
                            </span>
                          </button>

                          {showProof === msg.id && (
                            <div className="mt-2 p-4 bg-gray-900 border border-gray-700 rounded-lg text-xs">
                              {/* Proof Header */}
                              <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-700">
                                <div className="flex items-center gap-2">
                                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                  </svg>
                                  <div>
                                    <p className="font-medium text-white">Noir ZK Proof</p>
                                    <p className="text-gray-500">{msg.zkProof.type}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono text-gray-500">{msg.zkProof.proofId}</p>
                                </div>
                              </div>

                              {/* Public Inputs */}
                              <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="p-2 bg-gray-800 rounded">
                                  <span className="text-gray-500 block mb-1">Query Commitment</span>
                                  <span className="font-mono text-gray-300 break-all">{msg.zkProof.queryHash}</span>
                                </div>
                                <div className="p-2 bg-gray-800 rounded">
                                  <span className="text-gray-500 block mb-1">Response Commitment</span>
                                  <span className="font-mono text-gray-300 break-all">{msg.zkProof.responseHash}</span>
                                </div>
                                <div className="p-2 bg-gray-800 rounded">
                                  <span className="text-gray-500 block mb-1">Merkle Root</span>
                                  <span className="font-mono text-gray-300 break-all">{msg.zkProof.merkleRoot}</span>
                                </div>
                                <div className="p-2 bg-gray-800 rounded">
                                  <span className="text-gray-500 block mb-1">Verification Key</span>
                                  <span className="font-mono text-gray-300 break-all">{msg.zkProof.verificationKey}</span>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 pt-3 border-t border-gray-700">
                                <button
                                  onClick={() => {
                                    const proofData = JSON.stringify(msg.zkProof?.raw, null, 2);
                                    navigator.clipboard.writeText(proofData);
                                    alert('Proof data copied to clipboard!');
                                  }}
                                  className="flex-1 px-3 py-2 bg-white text-gray-900 font-medium text-xs rounded hover:bg-gray-100 transition-colors"
                                >
                                  Copy Proof
                                </button>
                                <a
                                  href={`https://noir-lang.org/docs/getting_started/hello_noir`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-1 px-3 py-2 border border-gray-600 text-gray-300 font-medium text-xs rounded text-center hover:border-white transition-colors"
                                >
                                  Learn Noir
                                </a>
                              </div>

                              {/* Technical Details */}
                              <div className="mt-4 p-3 bg-gray-800 rounded text-[10px] text-gray-400">
                                <p className="font-medium mb-1 text-gray-300">How Noir ZK Proofs Work:</p>
                                <ul className="list-disc list-inside space-y-1">
                                  <li><strong>Query Commitment:</strong> Poseidon hash of your encrypted question</li>
                                  <li><strong>Response Commitment:</strong> Poseidon hash of the AI response</li>
                                  <li><strong>Merkle Root:</strong> Combines both commitments for batch verification</li>
                                  <li><strong>Zero-Knowledge:</strong> Proves validity without revealing the actual content</li>
                                </ul>
                                <p className="mt-2">
                                  <strong>On-chain Verification:</strong> This proof can be verified on Solana using
                                  ~200k compute units via the UltraHonk verifier.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="p-4 bg-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <span className="text-sm text-gray-400">
                      {privacyEnabled ? 'Decrypting & Analyzing...' : 'Analyzing...'}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Questions */}
            <div className="flex flex-wrap gap-2">
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuestion(q)}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white disabled:opacity-50 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Question Input */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={privacyEnabled ? "Ask privately (encrypted with Arcium)..." : "Ask a question about this market..."}
                  className="w-full p-3 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-white focus:border-white"
                  onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
                  disabled={loading}
                />
                {privacyEnabled && (
                  <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
              </div>
              <button
                onClick={askQuestion}
                disabled={!question.trim() || loading}
                className="px-6 py-3 bg-white text-gray-900 font-medium text-sm rounded-lg disabled:opacity-50 hover:bg-gray-100 transition-colors"
              >
                {loading ? 'Asking...' : 'Ask'}
              </button>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-gray-800 border border-gray-700 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-gray-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-xs text-gray-400">
              <p className="font-medium mb-2 text-gray-300">Privacy & Verification Stack</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="font-medium text-white">Arcium Encryption</p>
                  <p>Your questions are encrypted client-side using x25519 ECDH.
                  The backend cannot read your queries - only the Arcium MPC network can decrypt them.</p>
                </div>
                <div>
                  <p className="font-medium text-white">Noir ZK Proofs</p>
                  <p>Each AI response includes a zero-knowledge proof generated using Noir circuits.
                  These proofs can be verified on Solana to ensure response integrity.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
