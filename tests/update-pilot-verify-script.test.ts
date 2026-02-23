import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

describe('update-pilot-verify script', () => {
  it('falha ao montar config em modo estrito sem chave publica', async () => {
    const { buildPilotVerificationConfigFromEnv } = await loadUpdatePilotScript();

    expect(() =>
      buildPilotVerificationConfigFromEnv({
        DEXTER_UPDATE_GITHUB_REPO: 'N1ghthill/dexter',
        DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST: '1'
      })
    ).toThrow(/REQUIRE_SIGNED_MANIFEST/);
  });

  it('valida manifesto assinado e checksum do asset quando verifyDownload esta ativo', async () => {
    const { runUpdatePilotVerification } = await loadUpdatePilotScript();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const artifactBytes = Buffer.from('dexter-real-pilot-artifact');
    const checksum = crypto.createHash('sha256').update(artifactBytes).digest('hex');
    const manifest = buildManifest('0.2.0', 'stable', checksum, 'https://example.invalid/dexter-0.2.0.AppImage');
    const manifestText = JSON.stringify(manifest);
    const signatureBase64 = crypto.sign(null, Buffer.from(manifestText, 'utf8'), privateKey).toString('base64');

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/releases?')) {
        return okJson([
          release('v0.2.0', false, 'https://example.invalid/manifest.json', 'https://example.invalid/manifest.json.sig')
        ]);
      }
      if (url === 'https://example.invalid/manifest.json') {
        return okText(manifestText);
      }
      if (url === 'https://example.invalid/manifest.json.sig') {
        return okText(signatureBase64);
      }
      if (url === 'https://example.invalid/dexter-0.2.0.AppImage') {
        return okBytes(artifactBytes);
      }
      throw new Error(`URL inesperada: ${url}`);
    });

    const report = await runUpdatePilotVerification({
      owner: 'N1ghthill',
      repo: 'dexter',
      channel: 'stable',
      verifyDownload: true,
      manifestPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(report.ok).toBe(true);
    expect(report.signatureVerificationEnabled).toBe(true);
    expect(report.selected?.version).toBe('0.2.0');
    expect(report.selected?.downloadVerified).toBe(true);
    expect(report.selected?.downloadBytes).toBe(artifactBytes.length);
  });

  it('ignora release quando assinatura e invalida e nenhuma release valida sobra', async () => {
    const { runUpdatePilotVerification } = await loadUpdatePilotScript();
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const checksum = 'a'.repeat(64);
    const manifestText = JSON.stringify(buildManifest('0.2.0', 'stable', checksum, 'https://example.invalid/dexter-0.2.0.AppImage'));

    const report = await runUpdatePilotVerification({
      owner: 'N1ghthill',
      repo: 'dexter',
      channel: 'stable',
      manifestPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      fetchImpl: vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([
            release('v0.2.0', false, 'https://example.invalid/manifest.json', 'https://example.invalid/manifest.json.sig')
          ]);
        }
        if (url === 'https://example.invalid/manifest.json') {
          return okText(manifestText);
        }
        if (url === 'https://example.invalid/manifest.json.sig') {
          return okText('invalid-signature');
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    });

    expect(report.ok).toBe(false);
    expect(report.selected).toBeNull();
    expect(report.skipped.some((item: { reason: string }) => item.reason === 'manifest_signature_invalid')).toBe(true);
  });

  it('no canal stable seleciona release estavel e registra warning quando assinatura esta desativada', async () => {
    const { runUpdatePilotVerification } = await loadUpdatePilotScript();
    const stableManifest = JSON.stringify(
      buildManifest('0.2.0', 'stable', 'b'.repeat(64), 'https://example.invalid/dexter-0.2.0.AppImage')
    );
    const rcManifest = JSON.stringify(
      buildManifest('0.2.1-rc.1', 'rc', 'c'.repeat(64), 'https://example.invalid/dexter-0.2.1-rc.1.AppImage')
    );

    const report = await runUpdatePilotVerification({
      owner: 'N1ghthill',
      repo: 'dexter',
      channel: 'stable',
      fetchImpl: vi.fn(async (url: string) => {
        if (url.includes('/releases?')) {
          return okJson([
            release('v0.2.1-rc.1', true, 'https://example.invalid/manifest-rc.json'),
            release('v0.2.0', false, 'https://example.invalid/manifest-stable.json')
          ]);
        }
        if (url === 'https://example.invalid/manifest-rc.json') {
          return okText(rcManifest);
        }
        if (url === 'https://example.invalid/manifest-stable.json') {
          return okText(stableManifest);
        }
        throw new Error(`URL inesperada: ${url}`);
      }) as unknown as typeof fetch
    });

    expect(report.ok).toBe(true);
    expect(report.signatureVerificationEnabled).toBe(false);
    expect(report.warnings.some((w: string) => w.includes('assinatura'))).toBe(true);
    expect(report.selected?.version).toBe('0.2.0');
    expect(report.selected?.channel).toBe('stable');
  });
});

function buildManifest(version: string, channel: 'stable' | 'rc', checksumSha256: string, downloadUrl: string) {
  return {
    version,
    channel,
    provider: 'github',
    publishedAt: new Date().toISOString(),
    releaseNotes: 'pilot release notes',
    downloadUrl,
    checksumSha256,
    components: {
      appVersion: version,
      coreVersion: version,
      uiVersion: version,
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
  };
}

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

function okBytes(bytes: Buffer) {
  return {
    ok: true,
    arrayBuffer: async () => bytes
  } as unknown as Response;
}

async function loadUpdatePilotScript(): Promise<any> {
  const modulePath: string = '../scripts/update-pilot-verify.mjs';
  return import(modulePath);
}
