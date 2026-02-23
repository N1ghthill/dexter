import type { UpdateManifest } from '@shared/contracts';
import type { UpdateCheckInput, UpdateDownloadResult, UpdateProvider } from '@main/services/update/UpdateProvider';

export class NoopUpdateProvider implements UpdateProvider {
  readonly kind = 'none' as const;

  async checkLatest(_input: UpdateCheckInput): Promise<UpdateManifest | null> {
    return null;
  }

  async download(_manifest: UpdateManifest): Promise<UpdateDownloadResult> {
    return {
      ok: false,
      stagedVersion: null,
      stagedArtifactPath: null,
      errorMessage: 'Nenhum provider de update configurado nesta fase.'
    };
  }
}
