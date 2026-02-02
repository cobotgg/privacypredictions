import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config/env.js';
import { getRPCStatus } from './services/rpc-provider.js';
import walletRouter from './routes/wallet.js';
import marketsRouter from './routes/markets.js';
import tradingRouter from './routes/trading.js';
import transferRouter from './routes/transfer.js';
import privacyRouter from './routes/privacy.js';
import aiRouter from './routes/ai.js';
import cardsRouter from './routes/cards.js';
import shadowwireRouter from './routes/shadowwire.js';
import privacycashRouter from './routes/privacycash.js';
import silentswapRouter from './routes/silentswap.js';
import complianceRouter from './routes/compliance.js';
import callsRouter from './routes/calls.js';
import attestationRouter from './routes/attestation.js';

const app = express();

// Middleware - allow multiple origins in development
const allowedOrigins = [
  config.frontendUrl,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  const rpcStatus = getRPCStatus();
  res.json({
    status: 'healthy',
    service: 'solana-privacy-trading',
    timestamp: new Date().toISOString(),
    rpc: {
      activeEndpoint: rpcStatus.activeEndpoint,
      healthyEndpoints: rpcStatus.healthyCount,
      totalEndpoints: rpcStatus.totalCount,
    },
  });
});

// RPC Provider status endpoint
app.get('/api/rpc/status', (_req, res) => {
  try {
    const status = getRPCStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API routes
app.use('/api/wallet', walletRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/trading', tradingRouter);
app.use('/api/transfer', transferRouter);
app.use('/api/privacy', privacyRouter);
app.use('/api/ai', aiRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/shadowwire', shadowwireRouter);
app.use('/api/privacycash', privacycashRouter);
app.use('/api/bridge', silentswapRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/calls', callsRouter);
app.use('/api/attestation', attestationRouter);

// Error handling
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
);

// Start server
app.listen(config.port, () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('  SOLANA PRIVACY TRADING API');
  console.log('='.repeat(60));
  console.log('');
  validateConfig();
  console.log('');
  console.log(`Server running on http://localhost:${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/health`);
  console.log('');
  console.log('API Endpoints:');
  console.log('  GET  /api/rpc/status       - RPC provider status (failover monitoring)');
  console.log('  GET  /api/wallet           - Main wallet info');
  console.log('  GET  /api/wallet/trading   - List trading wallets');
  console.log('  POST /api/wallet/trading   - Create trading wallet');
  console.log('  GET  /api/markets          - List active markets');
  console.log('  GET  /api/markets/trending - Top 5 trending markets');
  console.log('  POST /api/trading/order    - Place order');
  console.log('  GET  /api/trading/positions - Get positions');
  console.log('  POST /api/transfer/privacy - Privacy pool transfer');
  console.log('  POST /api/ai/analyze       - AI market analysis');
  console.log('  GET  /api/cards/price      - Get card pricing');
  console.log('  POST /api/cards/order      - Create card order');
  console.log('  GET  /api/cards/order/status - Check card order status');
  console.log('  GET  /api/shadowwire/status - ShadowWire status');
  console.log('  POST /api/shadowwire/transfer - Private transfer');
  console.log('  POST /api/shadowwire/deposit - Deposit to privacy pool');
  console.log('  POST /api/shadowwire/withdraw - Withdraw from privacy pool');
  console.log('  POST /api/shadowwire/pay-agent - Pay AI agent privately');
  console.log('  GET  /api/privacycash/status - Privacy Cash status');
  console.log('  POST /api/privacycash/transfer - Privacy Cash transfer');
  console.log('  POST /api/privacycash/deposit - Deposit to Privacy Cash');
  console.log('  POST /api/privacycash/withdraw - Withdraw from Privacy Cash');
  console.log('  GET  /api/bridge/status     - LI.FI bridge status');
  console.log('  GET  /api/bridge/quote      - Get cross-chain swap quote');
  console.log('  POST /api/bridge/swap       - Execute cross-chain swap (standard)');
  console.log('  GET  /api/bridge/private/quote - Get private bridge quote');
  console.log('  POST /api/bridge/private/bridge - Execute PRIVATE cross-chain bridge');
  console.log('  GET  /api/bridge/private/status/:id - Get private bridge status');
  console.log('  GET  /api/compliance/status - Range compliance status');
  console.log('  GET  /api/compliance/screen/address - Screen address');
  console.log('  POST /api/compliance/screen/transaction - Screen transaction');
  console.log('  GET  /api/calls/status         - Encrypted calls (Inco + Light Protocol)');
  console.log('  POST /api/calls/create         - Create encrypted prediction call');
  console.log('  GET  /api/calls/market/:id     - Get calls for a market');
  console.log('  GET  /api/calls/user/:wallet   - Get calls by user');
  console.log('  POST /api/calls/:id/reveal     - Reveal call with payment (~$0.20)');
  console.log('  POST /api/calls/market/:id/resolve - Resolve market & reveal calls');
  console.log('');
  console.log('  Light Protocol AI Attestations:');
  console.log('  GET  /api/attestation/status     - Attestation service status');
  console.log('  POST /api/attestation/create     - Create AI response attestation');
  console.log('  POST /api/attestation/batch      - Batch create attestations');
  console.log('  GET  /api/attestation/verify/:id - Verify attestation on-chain');
  console.log('  GET  /api/attestation/:id        - Get attestation by ID');
  console.log('  POST /api/attestation/ai/research - Research market with attestation');
  console.log('  POST /api/attestation/ai/analyze  - Analyze market with attestation');
  console.log('');
  console.log('='.repeat(60));
});
