import { TOKEN_DECIMALS, TOKEN_MINTS } from './constants.js';
import { TokenSymbol } from './types.js';

export class TokenUtils {
  static toSmallestUnit(amount: number, token: TokenSymbol): number {
    const decimals = this.getTokenDecimals(token);
    return Math.floor(amount * Math.pow(10, decimals));
  }

  static fromSmallestUnit(amount: number, token: TokenSymbol): number {
    const decimals = this.getTokenDecimals(token);
    return amount / Math.pow(10, decimals);
  }

  static getTokenDecimals(token: TokenSymbol): number {
    const decimals = TOKEN_DECIMALS[token];
    if (decimals === undefined) {
      throw new Error(`Unknown token: ${token}`);
    }
    return decimals;
  }

  static getTokenMint(token: TokenSymbol): string {
    const mint = TOKEN_MINTS[token];
    if (!mint) {
      throw new Error(`Unknown token: ${token}`);
    }
    return mint;
  }

  static isValidToken(token: string): token is TokenSymbol {
    return token in TOKEN_DECIMALS;
  }

  static getAllTokens(): TokenSymbol[] {
    return Object.keys(TOKEN_DECIMALS) as TokenSymbol[];
  }
}

