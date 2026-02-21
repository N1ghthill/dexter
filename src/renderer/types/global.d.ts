import type { DexterApi } from '@shared/api';

declare global {
  interface Window {
    dexter: DexterApi;
  }
}

export {};
