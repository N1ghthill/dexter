import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateManifest } from '@shared/contracts';
import { GitHubReleaseUpdateProvider } from '@main/services/update/GitHubReleaseUpdateProvider';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('GitHubReleaseUpdateProvider', () => {
  it('seleciona release stable com manifesto valido', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/releases?')) {
        return okJson([
          release('v0.1.4-rc.1', true, 'https://example.invalid/manifest-rc.json'),
          release('v0.1.4', false, 'https://example.invalid/manifest-stable.json')
        ]);
      }

      if (url === 'https://example.invalid/manifest-rc.json') {
        return okText(JSON.stringify(buildManifest('0.1.4-rc.1', 'rc')));
      }

      if (url === 'https://example.invalid/manifest-stable.json') {
        return okText(JSON.stringify(buildManifest('0.1.4', 'stable')));
      }

      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads')
    });

    const manifest = await provider.checkLatest({
      channel: 'stable',
      currentVersion: '0.1.3',
      currentComponents: baseComponents('0.1.3')
    });

    expect(manifest?.version).toBe('0.1.4');
    expect(manifest?.channel).toBe('stable');
  });

  it('retorna release rc mais nova quando canal rc', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([
            release('v0.1.4', false, 'https://example.invalid/manifest-stable.json'),
            release('v0.1.5-rc.1', true, 'https://example.invalid/manifest-rc.json')
          ]);
        }

        if (url === 'https://example.invalid/manifest-stable.json') {
          return okText(JSON.stringify(buildManifest('0.1.4', 'stable')));
        }

        if (url === 'https://example.invalid/manifest-rc.json') {
          return okText(JSON.stringify(buildManifest('0.1.5-rc.1', 'rc')));
        }

        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads')
    });

    const manifest = await provider.checkLatest({
      channel: 'rc',
      currentVersion: '0.1.4',
      currentComponents: baseComponents('0.1.4')
    });

    expect(manifest?.version).toBe('0.1.5-rc.1');
    expect(manifest?.channel).toBe('rc');
  });

  it('baixa asset, valida checksum e cria staging local', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);
    const bytes = Buffer.from('conteudo-de-update');
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://example.invalid/dexter-0.1.4.AppImage') {
          return {
            ok: true,
            arrayBuffer: async () => bytes
          } as unknown as Response;
        }

        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads')
    });

    const result = await provider.download({
      ...buildManifest('0.1.4', 'stable'),
      downloadUrl: 'https://example.invalid/dexter-0.1.4.AppImage',
      checksumSha256: checksum
    });

    expect(result.ok).toBe(true);
    expect(result.stagedVersion).toBe('0.1.4');
    expect(result.stagedArtifactPath).toBe(path.join(dir, 'downloads', '0.1.4', 'dexter-0.1.4.AppImage'));
    expect(fs.existsSync(path.join(dir, 'downloads', '0.1.4', 'dexter-0.1.4.AppImage'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'downloads', '0.1.4', 'manifest.json'))).toBe(true);
  });

  it('falha quando checksum nao confere', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from('conteudo-errado')
        } as unknown as Response;
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads')
    });

    const result = await provider.download({
      ...buildManifest('0.1.4', 'stable'),
      checksumSha256: 'f'.repeat(64)
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('Checksum');
  });

  it('remove diretorios antigos de staging apos download mantendo versao atual e limite configurado', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);
    const downloadsDir = path.join(dir, 'downloads');
    fs.mkdirSync(downloadsDir, { recursive: true });

    seedStagedVersionDir(downloadsDir, '0.1.1', 3);
    seedStagedVersionDir(downloadsDir, '0.1.2', 2);
    seedStagedVersionDir(downloadsDir, '0.1.3', 1);

    const bytes = Buffer.from('conteudo-de-update-cleanup');
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://example.invalid/dexter_0.1.4_amd64.deb') {
          return {
            ok: true,
            arrayBuffer: async () => bytes
          } as unknown as Response;
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: downloadsDir,
      maxStagedVersionsToKeep: 2
    });

    const result = await provider.download({
      ...buildManifest('0.1.4', 'stable'),
      downloadUrl: 'https://example.invalid/dexter_0.1.4_amd64.deb',
      checksumSha256: checksum,
      selectedArtifact: {
        platform: 'linux',
        arch: 'x64',
        packageType: 'deb',
        downloadUrl: 'https://example.invalid/dexter_0.1.4_amd64.deb',
        checksumSha256: checksum
      }
    });

    expect(result.ok).toBe(true);
    const remaining = fs
      .readdirSync(downloadsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(remaining).toEqual(['0.1.3', '0.1.4']);
  });

  it('aceita manifesto assinado quando chave publica configurada', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const manifestText = JSON.stringify(buildManifest('0.1.6', 'stable'));
    const signatureBase64 = crypto.sign(null, Buffer.from(manifestText, 'utf8'), privateKey).toString('base64');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([
            release('v0.1.6', false, 'https://example.invalid/manifest-signed.json', 'https://example.invalid/manifest-signed.json.sig')
          ]);
        }
        if (url === 'https://example.invalid/manifest-signed.json') {
          return okText(manifestText);
        }
        if (url === 'https://example.invalid/manifest-signed.json.sig') {
          return okText(signatureBase64);
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads'),
      manifestPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    });

    const manifest = await provider.checkLatest({
      channel: 'stable',
      currentVersion: '0.1.5',
      currentComponents: baseComponents('0.1.5')
    });

    expect(manifest?.version).toBe('0.1.6');
  });

  it('ignora release quando assinatura do manifesto e invalida', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);
    const { publicKey } = crypto.generateKeyPairSync('ed25519');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([
            release('v0.1.6', false, 'https://example.invalid/manifest.json', 'https://example.invalid/manifest.json.sig')
          ]);
        }
        if (url === 'https://example.invalid/manifest.json') {
          return okText(JSON.stringify(buildManifest('0.1.6', 'stable')));
        }
        if (url === 'https://example.invalid/manifest.json.sig') {
          return okText('not-a-valid-signature');
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads'),
      manifestPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    });

    const manifest = await provider.checkLatest({
      channel: 'stable',
      currentVersion: '0.1.5',
      currentComponents: baseComponents('0.1.5')
    });

    expect(manifest).toBeNull();
  });

  it('seleciona artefato .deb quando ambiente nao e AppImage e manifesto tem multiplos artefatos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);
    const manifest = buildManifest('0.1.7', 'stable');
    manifest.artifacts = [
      {
        platform: 'linux',
        arch: 'x64',
        packageType: 'appimage',
        downloadUrl: 'https://example.invalid/dexter-0.1.7.AppImage',
        checksumSha256: 'a'.repeat(64)
      },
      {
        platform: 'linux',
        arch: 'x64',
        packageType: 'deb',
        downloadUrl: 'https://example.invalid/dexter_0.1.7_amd64.deb',
        checksumSha256: 'b'.repeat(64)
      }
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([release('v0.1.7', false, 'https://example.invalid/manifest.json')]);
        }
        if (url === 'https://example.invalid/manifest.json') {
          return okText(JSON.stringify(manifest));
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads'),
      executablePath: '/usr/bin/dexter',
      platform: 'linux',
      arch: 'x64'
    });

    const selected = await provider.checkLatest({
      channel: 'stable',
      currentVersion: '0.1.6',
      currentComponents: baseComponents('0.1.6')
    });

    expect(selected?.selectedArtifact?.packageType).toBe('deb');
    expect(selected?.downloadUrl).toContain('.deb');
    expect(selected?.checksumSha256).toBe('b'.repeat(64));
  });

  it('prefere AppImage quando executando a partir de AppImage', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-gh-provider-'));
    tempDirs.push(dir);
    const manifest = buildManifest('0.1.8', 'stable');
    manifest.artifacts = [
      {
        platform: 'linux',
        arch: 'x64',
        packageType: 'deb',
        downloadUrl: 'https://example.invalid/dexter_0.1.8_amd64.deb',
        checksumSha256: 'b'.repeat(64)
      },
      {
        platform: 'linux',
        arch: 'x64',
        packageType: 'appimage',
        downloadUrl: 'https://example.invalid/dexter-0.1.8.AppImage',
        checksumSha256: 'a'.repeat(64)
      }
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([release('v0.1.8', false, 'https://example.invalid/manifest.json')]);
        }
        if (url === 'https://example.invalid/manifest.json') {
          return okText(JSON.stringify(manifest));
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    );

    const provider = new GitHubReleaseUpdateProvider({
      owner: 'N1ghthill',
      repo: 'dexter',
      downloadDir: path.join(dir, 'downloads'),
      executablePath: '/tmp/Dexter-0.1.8.AppImage',
      platform: 'linux',
      arch: 'x64'
    });

    const selected = await provider.checkLatest({
      channel: 'stable',
      currentVersion: '0.1.7',
      currentComponents: baseComponents('0.1.7')
    });

    expect(selected?.selectedArtifact?.packageType).toBe('appimage');
    expect(selected?.downloadUrl).toContain('.AppImage');
  });
});

function release(tagName: string, prerelease: boolean, manifestUrl: string, manifestSigUrl?: string) {
  const assets = [
    {
      name: 'dexter-update-manifest.json',
      browser_download_url: manifestUrl
    }
  ];

  if (manifestSigUrl) {
    assets.push({
      name: 'dexter-update-manifest.json.sig',
      browser_download_url: manifestSigUrl
    });
  }

  return {
    tag_name: tagName,
    draft: false,
    prerelease,
    assets
  };
}

function okJson(payload: unknown) {
  return {
    ok: true,
    json: async () => payload
  } as unknown as Response;
}

function okText(payload: string) {
  return {
    ok: true,
    text: async () => payload
  } as unknown as Response;
}

function seedStagedVersionDir(rootDir: string, version: string, mtimeOffsetSeconds: number) {
  const versionDir = path.join(rootDir, version);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, 'manifest.json'), '{}', 'utf8');
  const date = new Date(Date.now() - mtimeOffsetSeconds * 1000);
  fs.utimesSync(versionDir, date, date);
}

function buildManifest(version: string, channel: 'stable' | 'rc'): UpdateManifest {
  return {
    version,
    channel,
    provider: 'github' as const,
    publishedAt: new Date().toISOString(),
    releaseNotes: 'release notes',
    downloadUrl: `https://example.invalid/${version}.AppImage`,
    checksumSha256: 'a'.repeat(64),
    components: baseComponents(version),
    compatibility: {
      strategy: 'atomic' as const,
      requiresRestart: true,
      ipcContractCompatible: true,
      userDataSchemaCompatible: true,
      notes: []
    }
  };
}

function baseComponents(version: string) {
  return {
    appVersion: version,
    coreVersion: version,
    uiVersion: version,
    ipcContractVersion: 1,
    userDataSchemaVersion: 1
  };
}
