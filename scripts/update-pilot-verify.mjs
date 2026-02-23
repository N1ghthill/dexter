import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runUpdatePilotVerification(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch indisponivel no runtime atual');
  }

  const channel = options.channel === 'rc' ? 'rc' : 'stable';
  const apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const userAgent = options.userAgent ?? 'DexterUpdatePilotVerifier/0.1';
  const verifyDownload = options.verifyDownload === true;
  const signatureKeyPem = normalizeOptionalText(options.manifestPublicKeyPem);
  const manifestAssetName = options.manifestAssetName ?? 'dexter-update-manifest.json';
  const manifestSignatureAssetName = options.manifestSignatureAssetName ?? `${manifestAssetName}.sig`;

  const report = {
    ok: false,
    channel,
    repo: `${options.owner}/${options.repo}`,
    verifyDownload,
    signatureVerificationEnabled: Boolean(signatureKeyPem),
    selected: null,
    skipped: [],
    warnings: []
  };

  const releasesUrl = `${apiBaseUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/releases?per_page=15`;
  const releasesResponse = await fetchImpl(releasesUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': userAgent
    }
  });
  if (!releasesResponse.ok) {
    throw new Error(`GitHub API respondeu HTTP ${releasesResponse.status} para ${releasesUrl}`);
  }

  const releasesJson = await releasesResponse.json();
  const releases = Array.isArray(releasesJson) ? releasesJson : [];

  let best = null;
  for (const release of releases) {
    if (!isCandidateRelease(release, channel)) {
      continue;
    }

    const assets = Array.isArray(release.assets) ? release.assets : [];
    const manifestAsset = assets.find((asset) => asset?.name === manifestAssetName);
    if (!manifestAsset?.browser_download_url) {
      report.skipped.push({
        tag: stringOrNull(release?.tag_name),
        reason: 'manifest_asset_missing'
      });
      continue;
    }

    let manifestText;
    try {
      manifestText = await fetchText(fetchImpl, manifestAsset.browser_download_url, userAgent);
    } catch (error) {
      report.skipped.push({
        tag: stringOrNull(release?.tag_name),
        reason: 'manifest_fetch_failed',
        detail: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (signatureKeyPem) {
      const signatureAsset = assets.find((asset) => asset?.name === manifestSignatureAssetName);
      if (!signatureAsset?.browser_download_url) {
        report.skipped.push({
          tag: stringOrNull(release?.tag_name),
          reason: 'manifest_signature_missing'
        });
        continue;
      }

      let signatureBase64;
      try {
        signatureBase64 = await fetchText(fetchImpl, signatureAsset.browser_download_url, userAgent);
      } catch (error) {
        report.skipped.push({
          tag: stringOrNull(release?.tag_name),
          reason: 'manifest_signature_fetch_failed',
          detail: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      if (!verifyEd25519DetachedSignature(manifestText, signatureBase64, signatureKeyPem)) {
        report.skipped.push({
          tag: stringOrNull(release?.tag_name),
          reason: 'manifest_signature_invalid'
        });
        continue;
      }
    } else {
      report.warnings.push('verificacao de assinatura de manifesto desativada (chave publica ausente)');
    }

    let rawManifest;
    try {
      rawManifest = JSON.parse(manifestText);
    } catch {
      report.skipped.push({
        tag: stringOrNull(release?.tag_name),
        reason: 'manifest_json_invalid'
      });
      continue;
    }

    const validated = validateUpdateManifest(rawManifest);
    if (!validated.ok) {
      report.skipped.push({
        tag: stringOrNull(release?.tag_name),
        reason: 'manifest_invalid',
        detail: validated.error
      });
      continue;
    }

    const manifest = validated.manifest;
    if (channel === 'stable' && manifest.channel !== 'stable') {
      report.skipped.push({
        tag: stringOrNull(release?.tag_name),
        reason: 'channel_mismatch'
      });
      continue;
    }

    const versionKey = parseVersionKey(manifest.version);
    if (!versionKey) {
      report.skipped.push({
        tag: stringOrNull(release?.tag_name),
        reason: 'version_invalid'
      });
      continue;
    }

    if (!best || compareVersionKeys(versionKey, best.versionKey) > 0) {
      best = { manifest, versionKey };
    }
  }

  if (!best) {
    report.ok = false;
    report.selected = null;
    return report;
  }

  const selected = {
    version: best.manifest.version,
    channel: best.manifest.channel,
    publishedAt: best.manifest.publishedAt,
    downloadUrl: best.manifest.downloadUrl,
    checksumSha256: best.manifest.checksumSha256,
    signatureVerified: Boolean(signatureKeyPem),
    downloadVerified: false,
    downloadBytes: null
  };

  if (verifyDownload) {
    const response = await fetchImpl(best.manifest.downloadUrl, {
      headers: {
        Accept: 'application/octet-stream, */*',
        'User-Agent': userAgent
      }
    });
    if (!response.ok) {
      throw new Error(`Falha no download do asset para verificacao: HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest.toLowerCase() !== best.manifest.checksumSha256.toLowerCase()) {
      throw new Error('Checksum SHA256 do asset nao confere com o manifesto durante a verificacao de piloto.');
    }

    selected.downloadVerified = true;
    selected.downloadBytes = bytes.length;
  }

  report.ok = true;
  report.selected = selected;
  return report;
}

export function buildPilotVerificationConfigFromEnv(env = process.env) {
  const repo = parseRepoSpec(env.DEXTER_UPDATE_GITHUB_REPO);
  if (!repo) {
    throw new Error('DEXTER_UPDATE_GITHUB_REPO deve estar no formato <owner>/<repo>.');
  }

  const manifestPublicKeyPem = readPemFromEnv(env, 'DEXTER_UPDATE_MANIFEST_PUBLIC_KEY') ?? undefined;
  const requireSignedManifest =
    env.DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST === '1' || env.DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST === 'true';
  if (requireSignedManifest && !manifestPublicKeyPem) {
    throw new Error(
      'DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST=1 exige DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PEM ou DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH.'
    );
  }

  return {
    owner: repo.owner,
    repo: repo.repo,
    channel: env.DEXTER_UPDATE_CHANNEL === 'rc' ? 'rc' : 'stable',
    apiBaseUrl: normalizeOptionalText(env.DEXTER_UPDATE_API_BASE_URL) ?? undefined,
    manifestPublicKeyPem,
    verifyDownload: env.DEXTER_UPDATE_VERIFY_DOWNLOAD === '1' || env.DEXTER_UPDATE_VERIFY_DOWNLOAD === 'true'
  };
}

export function readPemFromEnv(env, prefix) {
  const direct = env?.[`${prefix}_PEM`];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.replace(/\\n/g, '\n').trim();
  }

  const pemPath = env?.[`${prefix}_PATH`];
  if (typeof pemPath === 'string' && pemPath.trim()) {
    return fs.readFileSync(path.resolve(pemPath.trim()), 'utf8').trim();
  }

  return undefined;
}

export function parseRepoSpec(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const [owner, repo] = value.trim().split('/');
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

async function fetchText(fetchImpl, url, userAgent) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: '*/*',
      'User-Agent': userAgent
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} para ${url}`);
  }
  return response.text();
}

function verifyEd25519DetachedSignature(manifestText, signatureBase64, publicKeyPem) {
  try {
    const signature = Buffer.from(String(signatureBase64).replace(/\s+/g, ''), 'base64');
    if (signature.length === 0) {
      return false;
    }

    return crypto.verify(null, Buffer.from(manifestText, 'utf8'), publicKeyPem, signature);
  } catch {
    return false;
  }
}

function validateUpdateManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'manifest deve ser objeto' };
  }

  const manifest = input;
  if (!isNonEmptyString(manifest.version)) {
    return { ok: false, error: 'version ausente' };
  }
  if (manifest.channel !== 'stable' && manifest.channel !== 'rc') {
    return { ok: false, error: 'channel invalido' };
  }
  if (manifest.provider !== 'github') {
    return { ok: false, error: 'provider invalido (esperado github)' };
  }
  if (!isIsoDate(manifest.publishedAt)) {
    return { ok: false, error: 'publishedAt invalido' };
  }
  if (!isNonEmptyString(manifest.releaseNotes)) {
    return { ok: false, error: 'releaseNotes ausente' };
  }
  if (!isHttpUrl(manifest.downloadUrl)) {
    return { ok: false, error: 'downloadUrl invalido' };
  }
  if (typeof manifest.checksumSha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(manifest.checksumSha256)) {
    return { ok: false, error: 'checksumSha256 invalido' };
  }
  if (!manifest.components || typeof manifest.components !== 'object') {
    return { ok: false, error: 'components ausente' };
  }
  if (!manifest.compatibility || typeof manifest.compatibility !== 'object') {
    return { ok: false, error: 'compatibility ausente' };
  }

  return { ok: true, manifest };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isCandidateRelease(release, channel) {
  if (!release || typeof release !== 'object') {
    return false;
  }
  if (release.draft) {
    return false;
  }

  const tag = normalizeTagToVersion(release.tag_name);
  if (!tag || !parseVersionKey(tag)) {
    return false;
  }

  if (channel === 'stable') {
    return release.prerelease !== true;
  }

  return true;
}

function normalizeTagToVersion(tagName) {
  if (typeof tagName !== 'string' || !tagName.trim()) {
    return null;
  }
  const normalized = tagName.trim();
  return normalized.startsWith('v') ? normalized.slice(1) : normalized;
}

function parseVersionKey(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareVersionKeys(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < max; i += 1) {
    const a = left.prerelease[i];
    const b = right.prerelease[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNum = /^\d+$/.test(a) ? Number(a) : null;
    const bNum = /^\d+$/.test(b) ? Number(b) : null;
    if (aNum !== null && bNum !== null) return aNum - bNum;
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    return a.localeCompare(b);
  }

  return 0;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    printHelp();
    return;
  }

  const config = buildPilotVerificationConfigFromEnv(process.env);
  const report = await runUpdatePilotVerification(config);
  printReport(report);

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function printReport(report) {
  console.log(`[update-pilot] repo=${report.repo} channel=${report.channel}`);
  console.log(`[update-pilot] signatureVerification=${report.signatureVerificationEnabled ? 'enabled' : 'disabled'}`);
  console.log(`[update-pilot] verifyDownload=${report.verifyDownload ? 'enabled' : 'disabled'}`);

  for (const warning of report.warnings) {
    console.log(`[update-pilot] warning: ${warning}`);
  }

  if (!report.ok || !report.selected) {
    console.log('[update-pilot] resultado: nenhum update valido encontrado');
    if (report.skipped.length > 0) {
      console.log('[update-pilot] releases ignoradas:');
      for (const item of report.skipped) {
        const suffix = item.detail ? ` (${item.detail})` : '';
        console.log(`  - tag=${item.tag ?? 'unknown'} reason=${item.reason}${suffix}`);
      }
    }
    return;
  }

  const selected = report.selected;
  console.log(`[update-pilot] resultado: ok version=${selected.version} channel=${selected.channel}`);
  console.log(`[update-pilot] manifest: publishedAt=${selected.publishedAt} signatureVerified=${selected.signatureVerified ? 'yes' : 'no'}`);
  console.log(`[update-pilot] asset: checksum=${selected.checksumSha256}`);
  if (selected.downloadVerified) {
    console.log(`[update-pilot] asset download verified: yes bytes=${selected.downloadBytes}`);
  }
}

function printHelp() {
  console.log(`Uso:
  npm run update:pilot:verify

Variaveis de ambiente:
  DEXTER_UPDATE_GITHUB_REPO=<owner>/<repo>          (obrigatoria)
  DEXTER_UPDATE_CHANNEL=stable|rc                   (opcional, default: stable)
  DEXTER_UPDATE_VERIFY_DOWNLOAD=1                   (opcional; baixa o asset e valida checksum)
  DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST=1           (opcional; falha se chave publica nao estiver configurada)
  DEXTER_UPDATE_API_BASE_URL=https://api.github.com (opcional; testes/mocks)

  DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PEM=<pem>       (opcional; recomendado)
  DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH=/caminho   (opcional; recomendado)
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[update-pilot] erro:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
