export { ShadowWireClient } from './client.js';

export { TokenUtils } from './tokens.js';

export {
  initWASM,
  generateRangeProof,
  verifyRangeProof,
  isWASMSupported,
  BULLETPROOF_INFO,
} from './zkProofs.js';

export {
  generateTransferSignature,
  determineSignatureTransferType,
} from './auth.js';

export {
  ShadowWireError,
  InsufficientBalanceError,
  InvalidAddressError,
  InvalidAmountError,
  RecipientNotFoundError,
  ProofUploadError,
  TransferError,
  NetworkError,
  WASMNotSupportedError,
  ProofGenerationError,
} from './errors.js';

export {
  SUPPORTED_TOKENS,
} from './types.js';

export type {
  TokenSymbol,
  SolanaNetwork,
  TransferType,
  SignatureTransferType,
  ShadowWireClientConfig,
  WalletAdapter,
  SignatureAuth,
  PoolBalance,
  DepositRequest,
  DepositResponse,
  WithdrawRequest,
  WithdrawResponse,
  UploadProofRequest,
  UploadProofResponse,
  ExternalTransferRequest,
  InternalTransferRequest,
  ZKTransferResponse,
  TransferRequest,
  TransferResponse,
  ZKProofData,
  TransferWithClientProofsRequest,
  BulletproofVerificationData,
  VerificationUploadResponse,
  VerifiedTransferResponse,
  VerificationStatus,
} from './types.js';

export { TOKEN_FEES, TOKEN_MINIMUMS, TOKEN_MINTS, TOKEN_DECIMALS } from './constants.js';
