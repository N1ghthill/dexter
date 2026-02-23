import type { ComponentVersionSet, UpdateChannel, UpdateManifest } from '@shared/contracts';

export interface UpdateCheckInput {
  channel: UpdateChannel;
  currentVersion: string;
  currentComponents: ComponentVersionSet;
}

export interface UpdateDownloadResult {
  ok: boolean;
  stagedVersion: string | null;
  stagedArtifactPath: string | null;
  errorMessage: string | null;
}

export interface UpdateProvider {
  readonly kind: UpdateManifest['provider'];
  checkLatest(input: UpdateCheckInput): Promise<UpdateManifest | null>;
  download(manifest: UpdateManifest): Promise<UpdateDownloadResult>;
}
