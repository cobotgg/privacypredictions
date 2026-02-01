export class ShadowWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowWireError';
    Object.setPrototypeOf(this, ShadowWireError.prototype);
  }
}

export class InsufficientBalanceError extends ShadowWireError {
  constructor(message: string = 'Insufficient balance for this operation') {
    super(message);
    this.name = 'InsufficientBalanceError';
    Object.setPrototypeOf(this, InsufficientBalanceError.prototype);
  }
}

export class InvalidAddressError extends ShadowWireError {
  constructor(address: string) {
    super(`Invalid Solana address: ${address}`);
    this.name = 'InvalidAddressError';
    Object.setPrototypeOf(this, InvalidAddressError.prototype);
  }
}

export class InvalidAmountError extends ShadowWireError {
  constructor(message: string = 'Invalid amount specified') {
    super(message);
    this.name = 'InvalidAmountError';
    Object.setPrototypeOf(this, InvalidAmountError.prototype);
  }
}

export class RecipientNotFoundError extends ShadowWireError {
  constructor(recipient: string) {
    super(`Recipient not found in ShadowPay system: ${recipient}. Try using an external transfer instead.`);
    this.name = 'RecipientNotFoundError';
    Object.setPrototypeOf(this, RecipientNotFoundError.prototype);
  }
}

export class ProofUploadError extends ShadowWireError {
  constructor(message: string = 'Failed to upload zero-knowledge proof') {
    super(message);
    this.name = 'ProofUploadError';
    Object.setPrototypeOf(this, ProofUploadError.prototype);
  }
}

export class TransferError extends ShadowWireError {
  constructor(message: string = 'Transfer execution failed') {
    super(message);
    this.name = 'TransferError';
    Object.setPrototypeOf(this, TransferError.prototype);
  }
}

export class NetworkError extends ShadowWireError {
  constructor(message: string = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class WASMNotSupportedError extends ShadowWireError {
  constructor() {
    super('WebAssembly is not supported in this environment. Use backend proof generation instead.');
    this.name = 'WASMNotSupportedError';
    Object.setPrototypeOf(this, WASMNotSupportedError.prototype);
  }
}

export class ProofGenerationError extends ShadowWireError {
  constructor(message: string = 'Failed to generate zero-knowledge proof') {
    super(message);
    this.name = 'ProofGenerationError';
    Object.setPrototypeOf(this, ProofGenerationError.prototype);
  }
}

