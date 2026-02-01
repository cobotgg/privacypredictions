import 'dotenv/config';

// Validate required environment variables
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string = ''): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optionalEnv('PORT', '3001')),
  frontendUrl: optionalEnv('FRONTEND_URL', 'http://localhost:5173'),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // Solana
  solanaRpcUrl: requireEnv('SOLANA_RPC_URL'),
  mainWalletPrivateKey: requireEnv('MAIN_WALLET_PRIVATE_KEY'),
  usdcMint: optionalEnv('USDC_MINT', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  wsolMint: optionalEnv('WSOL_MINT', 'So11111111111111111111111111111111111111112'),

  // RPC Provider URLs (for failover - priority: Helius > QuickNode > Alchemy)
  heliusRpcUrl: optionalEnv('HELIUS_RPC_URL'),
  quicknodeRpcUrl: optionalEnv('QUICKNODE_RPC_URL'),
  alchemyRpcUrl: optionalEnv('ALCHEMY_RPC_URL'),

  // DFlow
  dflowApiKey: requireEnv('DFLOW_API_KEY'),
  dflowMetadataApiUrl: optionalEnv('DFLOW_METADATA_API_URL', 'https://a.prediction-markets-api.dflow.net/api/v1'),
  dflowTradeApiUrl: optionalEnv('DFLOW_TRADE_API_URL', 'https://quote-api.dflow.net/api/v1'),

  // OpenAI
  openaiApiKey: optionalEnv('OPENAI_API_KEY'),
  openaiModel: optionalEnv('OPENAI_MODEL', 'gpt-4-turbo-preview'),

  // RPC Providers (for reference)
  alchemyApiKey: optionalEnv('ALCHEMY_API_KEY'),
  heliusApiKey: optionalEnv('HELIUS_API_KEY'),

  // Privacy Pool
  privacyPoolProgramId: optionalEnv('PRIVACY_POOL_PROGRAM_ID'),
  privacyPoolFeeBps: parseInt(optionalEnv('PRIVACY_POOL_FEE_BPS', '50')),

  // On-Chain ZK Verification (devnet deployed)
  zkVerifierProgramId: optionalEnv('ZK_VERIFIER_PROGRAM_ID', 'HMQZRtXdzSw7KjfW9gs6j17iVGtidkirVbYbwGosXNFv'),
  privacyTradingProgramId: optionalEnv('PRIVACY_TRADING_PROGRAM_ID', 'PrvTrade11111111111111111111111111111111111'),

  // Arcium MPC
  arciumClusterOffset: parseInt(optionalEnv('ARCIUM_CLUSTER_OFFSET', '0')),
  arciumEnabled: optionalEnv('ARCIUM_ENABLED', 'true') === 'true',

  // Logging
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
  debugTransactions: optionalEnv('DEBUG_TRANSACTIONS', 'false') === 'true',

  // Starpay Cards
  starpayApiKey: optionalEnv('STARPAY_API_KEY'),
  starpayCardEmail: optionalEnv('STARPAY_CARD_EMAIL'),
  starpayDefaultAmount: parseInt(optionalEnv('STARPAY_DEFAULT_AMOUNT', '5')),

  // ShadowWire (Radr Labs)
  shadowwireEnabled: optionalEnv('SHADOWWIRE_ENABLED', 'true') === 'true',

  // SilentSwap (uses wallet-based auth, not API keys)
  silentswapIntegratorId: optionalEnv('SILENTSWAP_INTEGRATOR_ID', 'privacy-prediction-markets'),
  silentswapEnvironment: optionalEnv('SILENTSWAP_ENVIRONMENT', 'mainnet') as 'mainnet' | 'staging',

  // Range Compliance
  rangeApiKey: optionalEnv('RANGE_API_KEY'),
};

// Validate config on import
export function validateConfig(): void {
  console.log('Configuration loaded:');
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - Port: ${config.port}`);
  console.log(`  - RPC URL: ${config.solanaRpcUrl.substring(0, 40)}...`);
  console.log(`  - DFlow API: ${config.dflowMetadataApiUrl}`);
  console.log(`  - OpenAI: ${config.openaiApiKey ? `Configured (${config.openaiModel})` : 'Not configured'}`);
  console.log(`  - Privacy Pool Fee: ${config.privacyPoolFeeBps} bps`);
  console.log(`  - Main Wallet: Loaded`);
  console.log('');
  console.log('Hackathon Integrations:');
  console.log(`  - Starpay Cards: ${config.starpayApiKey ? 'Enabled' : 'Not configured'}`);
  console.log(`  - ShadowWire: ${config.shadowwireEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  - SilentSwap: Enabled (integrator: ${config.silentswapIntegratorId})`);
  console.log(`  - Range Compliance: ${config.rangeApiKey ? 'Enabled' : 'Not configured'}`);
}
