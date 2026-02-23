declare module '../scripts/update-pilot-verify.mjs' {
  export function runUpdatePilotVerification(options: {
    owner: string;
    repo: string;
    channel?: 'stable' | 'rc';
    apiBaseUrl?: string;
    userAgent?: string;
    verifyDownload?: boolean;
    manifestPublicKeyPem?: string;
    manifestAssetName?: string;
    manifestSignatureAssetName?: string;
    fetchImpl?: typeof fetch;
  }): Promise<{
    ok: boolean;
    channel: 'stable' | 'rc';
    repo: string;
    verifyDownload: boolean;
    signatureVerificationEnabled: boolean;
    selected: {
      version: string;
      channel: 'stable' | 'rc';
      publishedAt: string;
      downloadUrl: string;
      checksumSha256: string;
      signatureVerified: boolean;
      downloadVerified: boolean;
      downloadBytes: number | null;
    } | null;
    skipped: Array<{ tag: string | null; reason: string; detail?: string }>;
    warnings: string[];
  }>;

  export function buildPilotVerificationConfigFromEnv(env?: NodeJS.ProcessEnv | Record<string, string>): {
    owner: string;
    repo: string;
    channel: 'stable' | 'rc';
    apiBaseUrl?: string;
    manifestPublicKeyPem?: string;
    verifyDownload: boolean;
  };
}
