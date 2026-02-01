/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_STANDALONE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
