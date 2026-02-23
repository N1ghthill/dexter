import { describe, expect, it } from 'vitest';
import { UpdateManifestValidator } from '@main/services/update/UpdateManifestValidator';

describe('UpdateManifestValidator', () => {
  it('valida manifesto correto', () => {
    const validator = new UpdateManifestValidator();
    const result = validator.validate({
      version: '0.1.4',
      channel: 'stable',
      provider: 'github',
      publishedAt: new Date().toISOString(),
      releaseNotes: 'ok',
      downloadUrl: 'https://github.com/N1ghthill/dexter/releases/download/v0.1.4/dexter.AppImage',
      checksumSha256: 'a'.repeat(64),
      artifacts: [
        {
          platform: 'linux',
          arch: 'x64',
          packageType: 'appimage',
          downloadUrl: 'https://example.invalid/dexter.AppImage',
          checksumSha256: 'a'.repeat(64)
        },
        {
          platform: 'linux',
          arch: 'x64',
          packageType: 'deb',
          downloadUrl: 'https://example.invalid/dexter.deb',
          checksumSha256: 'b'.repeat(64)
        }
      ],
      components: {
        appVersion: '0.1.4',
        coreVersion: '0.1.4',
        uiVersion: '0.1.4',
        ipcContractVersion: 1,
        userDataSchemaVersion: 1
      },
      compatibility: {
        strategy: 'atomic',
        requiresRestart: true,
        ipcContractCompatible: true,
        userDataSchemaCompatible: true,
        notes: []
      }
    });

    expect(result.ok).toBe(true);
  });

  it('rejeita artifacts com packageType invalido', () => {
    const validator = new UpdateManifestValidator();
    const result = validator.validate({
      version: '0.1.4',
      channel: 'stable',
      provider: 'github',
      publishedAt: new Date().toISOString(),
      releaseNotes: 'ok',
      downloadUrl: 'https://example.invalid/file.AppImage',
      checksumSha256: 'a'.repeat(64),
      artifacts: [
        {
          platform: 'linux',
          arch: 'x64',
          packageType: 'rpm',
          downloadUrl: 'https://example.invalid/file.rpm',
          checksumSha256: 'a'.repeat(64)
        }
      ],
      components: {
        appVersion: '0.1.4',
        coreVersion: '0.1.4',
        uiVersion: '0.1.4',
        ipcContractVersion: 1,
        userDataSchemaVersion: 1
      },
      compatibility: {
        strategy: 'atomic',
        requiresRestart: true,
        ipcContractCompatible: true,
        userDataSchemaCompatible: true,
        notes: []
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('esperava erro');
    }
    expect(result.error).toContain('artifacts');
  });

  it('rejeita manifesto com checksum invalido', () => {
    const validator = new UpdateManifestValidator();
    const result = validator.validate({
      version: '0.1.4',
      channel: 'stable',
      provider: 'github',
      publishedAt: new Date().toISOString(),
      releaseNotes: 'ok',
      downloadUrl: 'https://example.invalid/file',
      checksumSha256: 'xyz',
      components: {
        appVersion: '0.1.4',
        coreVersion: '0.1.4',
        uiVersion: '0.1.4',
        ipcContractVersion: 1,
        userDataSchemaVersion: 1
      },
      compatibility: {
        strategy: 'atomic',
        requiresRestart: true,
        ipcContractCompatible: true,
        userDataSchemaCompatible: true,
        notes: []
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('esperava erro');
    }
    expect(result.error).toContain('checksumSha256');
  });
});
