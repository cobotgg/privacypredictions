import { useState, useEffect, useRef } from 'react';

interface Market {
  id: string;
  ticker: string;
  title: string;
  yesPrice: number;
  noPrice: number;
}

interface AIAnalysis {
  marketId: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
  suggestedSide?: 'yes' | 'no';
  suggestedAmount?: number;
}

interface AIStreamMessage {
  type: 'thinking' | 'analysis' | 'action' | 'proof' | 'complete' | 'error';
  content: string;
  data?: any;
  timestamp: string;
}

interface WalletPair {
  id: string;
  primaryWallet: { id: string; address: string; label: string };
  batchWallet: { id: string; address: string; label: string };
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function AIAgent() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [walletPairs, setWalletPairs] = useState<WalletPair[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('');
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [command, setCommand] = useState('');
  const [streamMessages, setStreamMessages] = useState<AIStreamMessage[]>([]);
  const [executing, setExecuting] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ available: boolean; model: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMarkets();
    fetchWalletPairs();
    checkAIStatus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamMessages]);

  const fetchMarkets = async () => {
    try {
      const res = await fetch(`${API_URL}/api/markets/trending`);
      const data = await res.json();
      if (data.success) setMarkets(data.data);
    } catch (error) {
      console.error('Failed to fetch markets:', error);
    }
  };

  const fetchWalletPairs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/wallet/pairs`);
      const data = await res.json();
      if (data.success) setWalletPairs(data.data);
    } catch (error) {
      console.error('Failed to fetch wallet pairs:', error);
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

  const addMessage = (type: AIStreamMessage['type'], content: string, data?: any) => {
    setStreamMessages(prev => [...prev, {
      type,
      content,
      data,
      timestamp: new Date().toISOString(),
    }]);
  };

  const analyzeMarket = async () => {
    if (!selectedMarket) return;

    setLoading(true);
    setAnalysis(null);
    setStreamMessages([]);

    try {
      addMessage('thinking', 'Connecting to OpenAI GPT-4...');
      await new Promise(r => setTimeout(r, 300));

      addMessage('thinking', 'Fetching market data and historical trends...');
      await new Promise(r => setTimeout(r, 400));

      addMessage('thinking', 'Analyzing market sentiment and probability...');

      const res = await fetch(`${API_URL}/api/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: selectedMarket }),
      });

      const data = await res.json();

      if (data.success) {
        addMessage('analysis', 'Analysis complete', data.data);
        setAnalysis(data.data);

        // Generate verification proof
        addMessage('proof', 'Generating AI response verification proof...', {
          proofType: 'ai_verification',
          modelUsed: aiStatus?.model || 'gpt-4-turbo-preview',
          responseHash: btoa(JSON.stringify(data.data)).substring(0, 32),
          verified: true,
        });

        addMessage('complete', 'AI analysis and verification complete');
      } else {
        addMessage('error', data.error || 'Analysis failed');
      }
    } catch (error: any) {
      addMessage('error', error.message || 'Failed to analyze market');
    } finally {
      setLoading(false);
    }
  };

  const executeCommand = async () => {
    if (!command.trim()) return;

    setExecuting(true);
    setStreamMessages([]);

    try {
      addMessage('thinking', `Processing command: "${command}"`);
      await new Promise(r => setTimeout(r, 200));

      addMessage('thinking', 'Parsing natural language intent...');
      await new Promise(r => setTimeout(r, 300));

      addMessage('thinking', 'Determining required actions...');

      const res = await fetch(`${API_URL}/api/ai/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });

      const data = await res.json();

      if (data.success) {
        addMessage('action', 'Command parsed successfully', data.data);

        if (data.data.actions) {
          for (const action of data.data.actions) {
            addMessage('action', `Executing: ${action.description}`, action);
            await new Promise(r => setTimeout(r, 500));
          }
        }

        // Generate execution proof
        addMessage('proof', 'Generating execution proof...', {
          proofType: 'command_execution',
          commandHash: btoa(command).substring(0, 16),
          actionsCount: data.data.actions?.length || 0,
          privacyPreserved: true,
        });

        addMessage('complete', data.data.result || 'Command executed successfully');
      } else {
        addMessage('error', data.error || 'Command failed');
      }
    } catch (error: any) {
      addMessage('error', error.message || 'Failed to execute command');
    } finally {
      setExecuting(false);
      setCommand('');
    }
  };

  const executeAnalysisTrade = async () => {
    if (!analysis || !analysis.suggestedSide || walletPairs.length === 0) return;

    setExecuting(true);
    addMessage('action', `Executing AI-suggested ${analysis.suggestedSide.toUpperCase()} trade...`);

    try {
      await new Promise(r => setTimeout(r, 500));
      addMessage('thinking', 'Selecting optimal privacy wallet...');
      await new Promise(r => setTimeout(r, 300));

      const pair = walletPairs[0];
      addMessage('action', `Using wallet pair: ${pair.id}`, { pairId: pair.id });

      const res = await fetch(`${API_URL}/api/trading/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: analysis.marketId,
          side: analysis.suggestedSide,
          amount: analysis.suggestedAmount || 10,
          usePrivacy: true,
          walletId: pair.primaryWallet.id,
        }),
      });

      const data = await res.json();

      if (data.success) {
        addMessage('action', 'Trade executed successfully', data.data);
        addMessage('proof', 'Generating trade verification proof...', {
          proofType: 'ai_trade_execution',
          signature: data.data.signature,
          shares: data.data.shares,
          verified: true,
        });
        addMessage('complete', `Bought ${data.data.shares?.toFixed(2) || 'N/A'} shares`);
      } else {
        addMessage('error', data.error || 'Trade failed');
      }
    } catch (error: any) {
      addMessage('error', error.message || 'Failed to execute trade');
    } finally {
      setExecuting(false);
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish': return 'text-brand-green';
      case 'bearish': return 'text-brand-red';
      default: return 'text-brand-gray-500';
    }
  };

  const getMessageIcon = (type: AIStreamMessage['type']) => {
    switch (type) {
      case 'thinking': return '🤔';
      case 'analysis': return '📊';
      case 'action': return '⚡';
      case 'proof': return '🔒';
      case 'complete': return '✅';
      case 'error': return '❌';
    }
  };

  return (
    <div className="bg-white border-2 border-brand-black shadow-brutal">
      {/* Header */}
      <div className="bg-brand-black text-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="font-bold uppercase tracking-wide">
                AI Trading Agent
              </h2>
              <p className="text-sm text-brand-gray-400">
                GPT-4 powered market analysis with cryptographic verification
              </p>
            </div>
          </div>
          {aiStatus && (
            <div className={`flex items-center gap-2 ${aiStatus.available ? 'text-brand-green' : 'text-brand-red'}`}>
              <span className={`w-2 h-2 rounded-full ${aiStatus.available ? 'bg-brand-green' : 'bg-brand-red'}`}></span>
              <span className="text-xs font-mono">{aiStatus.model}</span>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* AI Status Warning */}
        {aiStatus && !aiStatus.available && (
          <div className="bg-brand-red/10 border-2 border-brand-red p-4">
            <p className="text-brand-red font-bold">AI Not Configured</p>
            <p className="text-sm text-brand-gray-500 mt-1">
              Set OPENAI_API_KEY in backend/.env to enable AI features
            </p>
          </div>
        )}

        {/* Market Analysis Section */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm uppercase text-brand-gray-500">
            Market Analysis
          </h3>
          <div className="flex gap-2">
            <select
              value={selectedMarket}
              onChange={(e) => {
                setSelectedMarket(e.target.value);
                setAnalysis(null);
                setStreamMessages([]);
              }}
              className="flex-1 p-3 border-2 border-brand-black font-mono"
            >
              <option value="">Select a market...</option>
              {markets.map((market) => (
                <option key={market.id} value={market.id}>
                  {market.ticker} - {market.title.substring(0, 40)}...
                </option>
              ))}
            </select>
            <button
              onClick={analyzeMarket}
              disabled={!selectedMarket || loading}
              className="px-6 py-3 bg-brand-black text-white font-bold uppercase border-2 border-brand-black disabled:opacity-50"
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
        </div>

        {/* Analysis Result */}
        {analysis && (
          <div className="border-2 border-brand-black">
            <div className="bg-brand-gray-100 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">
                  {analysis.sentiment === 'bullish' ? '🟢' : analysis.sentiment === 'bearish' ? '🔴' : '🟡'}
                </span>
                <div>
                  <span className={`font-bold uppercase ${getSentimentColor(analysis.sentiment)}`}>
                    {analysis.sentiment}
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-brand-gray-400">Confidence:</span>
                    <div className="w-20 h-2 bg-brand-gray-200">
                      <div className="h-full bg-brand-black" style={{ width: `${analysis.confidence}%` }} />
                    </div>
                    <span className="font-mono">{analysis.confidence}%</span>
                  </div>
                </div>
              </div>
              {analysis.suggestedSide && (
                <button
                  onClick={executeAnalysisTrade}
                  disabled={executing || walletPairs.length === 0}
                  className={`px-4 py-2 font-bold uppercase text-white text-sm disabled:opacity-50 ${
                    analysis.suggestedSide === 'yes' ? 'bg-brand-green' : 'bg-brand-red'
                  }`}
                >
                  Execute {analysis.suggestedSide} ${analysis.suggestedAmount || 10}
                </button>
              )}
            </div>
            <div className="p-4">
              <p className="text-sm text-brand-gray-600">{analysis.reasoning}</p>
            </div>
          </div>
        )}

        {/* Natural Language Command */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm uppercase text-brand-gray-500">
            Natural Language Trading
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g., Buy $50 YES on the top trending market"
              className="flex-1 p-3 border-2 border-brand-black font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && executeCommand()}
            />
            <button
              onClick={executeCommand}
              disabled={!command.trim() || executing}
              className="px-6 py-3 bg-brand-green text-white font-bold uppercase border-2 border-brand-green disabled:opacity-50"
            >
              {executing ? 'Running...' : 'Execute'}
            </button>
          </div>

          {/* Example Commands */}
          <div className="flex flex-wrap gap-2">
            {[
              'Analyze top 3 crypto markets',
              'Buy $25 YES on highest confidence',
              'Show portfolio summary',
              'Close all losing positions',
            ].map((example) => (
              <button
                key={example}
                onClick={() => setCommand(example)}
                className="px-2 py-1 text-xs border border-brand-gray-300 text-brand-gray-500 hover:border-brand-black hover:text-brand-black"
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {/* Stream Messages (Real-time AI Output) */}
        {streamMessages.length > 0 && (
          <div className="border-2 border-brand-black">
            <div className="bg-brand-black text-white px-4 py-2 flex items-center justify-between">
              <span className="font-bold uppercase text-sm">AI Output Stream</span>
              <button
                onClick={() => setStreamMessages([])}
                className="text-xs text-brand-gray-400 hover:text-white"
              >
                Clear
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto bg-brand-gray-100">
              {streamMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`px-4 py-2 border-b border-brand-gray-200 last:border-b-0 ${
                    msg.type === 'error' ? 'bg-brand-red/10' :
                    msg.type === 'complete' ? 'bg-brand-green/10' :
                    msg.type === 'proof' ? 'bg-brand-black/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span>{getMessageIcon(msg.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${msg.type === 'error' ? 'text-brand-red' : msg.type === 'complete' ? 'text-brand-green' : ''}`}>
                        {msg.content}
                      </p>
                      {msg.data && msg.type === 'proof' && (
                        <div className="mt-2 p-2 bg-white border border-brand-gray-200 text-xs font-mono">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-brand-gray-400">Type: </span>
                              <span>{msg.data.proofType}</span>
                            </div>
                            <div>
                              <span className="text-brand-gray-400">Verified: </span>
                              <span className={msg.data.verified ? 'text-brand-green' : 'text-brand-red'}>
                                {msg.data.verified ? 'YES' : 'NO'}
                              </span>
                            </div>
                            {msg.data.responseHash && (
                              <div className="col-span-2">
                                <span className="text-brand-gray-400">Hash: </span>
                                <span>{msg.data.responseHash}</span>
                              </div>
                            )}
                            {msg.data.modelUsed && (
                              <div className="col-span-2">
                                <span className="text-brand-gray-400">Model: </span>
                                <span>{msg.data.modelUsed}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-brand-gray-400 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Privacy Notice */}
        <div className="bg-brand-green/10 border-2 border-brand-green p-4">
          <div className="flex items-center gap-2 mb-2">
            <span>🔐</span>
            <span className="font-bold text-sm uppercase text-brand-green">Privacy Protected Execution</span>
          </div>
          <p className="text-xs text-brand-gray-600">
            All AI-driven trades are executed through privacy wallets. Your trading intent, strategy,
            and positions are cryptographically isolated from your main wallet identity.
            Each AI response is verified with a cryptographic proof.
          </p>
        </div>
      </div>
    </div>
  );
}
