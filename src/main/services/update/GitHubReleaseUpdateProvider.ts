import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateManifest } from '@shared/contracts';
import { UpdateManifestValidator } from '@main/services/update/UpdateManifestValidator';
import type { UpdateCheckInput, UpdateDownloadResult, UpdateProvider } from '@main/services/update/UpdateProvider';

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

interface GitHubReleaseUpdateProviderOptions {
  owner: string;
  repo: string;
  downloadDir: string;
  apiBaseUrl?: string;
  userAgent?: string;
  manifestAssetName?: string;
  manifestSignatureAssetName?: string;
  manifestPublicKeyPem?: string;
  validator?: UpdateManifestValidator;
}

export class GitHubReleaseUpdateProvider implements UpdateProvider {
  readonly kind = 'github' as const;

  private readonly owner: string;
  private readonly repo: string;
  private readonly downloadDir: string;
  private readonly apiBaseUrl: string;
  private readonly userAgent: string;
  private readonly manifestAssetName: string;
  private readonly manifestSignatureAssetName: string;
  private readonly manifestPublicKeyPem: string | null;
  private readonly validator: UpdateManifestValidator;

  constructor(options: GitHubReleaseUpdateProviderOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.downloadDir = options.downloadDir;
    this.apiBaseUrl = (options.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.userAgent = options.userAgent ?? 'DexterUpdateProvider/0.1';
    this.manifestAssetName = options.manifestAssetName ?? 'dexter-update-manifest.json';
    this.manifestSignatureAssetName = options.manifestSignatureAssetName ?? `${this.manifestAssetName}.sig`;
    this.manifestPublicKeyPem = normalizeOptionalText(options.manifestPublicKeyPem);
    this.validator = options.validator ?? new UpdateManifestValidator();
  }

  async checkLatest(input: UpdateCheckInput): Promise<UpdateManifest | null> {
    const releases = await this.fetchReleases();
    const candidates = releases.filter((release) => isCandidateRelease(release, input.channel));

    let best: { manifest: UpdateManifest; versionKey: VersionKey } | null = null;

    for (const release of candidates) {
      const manifestAsset = (release.assets ?? []).find((asset) => asset.name === this.manifestAssetName);
      if (!manifestAsset?.browser_download_url) {
        continue;
      }

      const manifestText = await this.fetchText(manifestAsset.browser_download_url);
      if (!(await this.verifyManifestSignatureIfConfigured(release, manifestText))) {
        continue;
      }

      const rawManifest = parseJsonSafe(manifestText);
      if (rawManifest === null) {
        continue;
      }
      const validated = this.validator.validate(rawManifest);
      if (!validated.ok) {
        continue;
      }

      const manifest = validated.manifest;
      if (manifest.provider !== 'github') {
        continue;
      }

      if (input.channel === 'stable' && manifest.channel !== 'stable') {
        continue;
      }

      const parsed = parseVersionKey(manifest.version);
      if (!parsed) {
        continue;
      }

      if (!best || compareVersionKeys(parsed, best.versionKey) > 0) {
        best = {
          manifest,
          versionKey: parsed
        };
      }
    }

    return best?.manifest ?? null;
  }

  async download(manifest: UpdateManifest): Promise<UpdateDownloadResult> {
    try {
      const response = await fetch(manifest.downloadUrl, {
        headers: {
          Accept: 'application/octet-stream, */*',
          'User-Agent': this.userAgent
        }
      });

      if (!response.ok) {
        return {
          ok: false,
          stagedVersion: null,
          stagedArtifactPath: null,
          errorMessage: `Falha no download do asset: HTTP ${response.status}.`
        };
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest.toLowerCase() !== manifest.checksumSha256.toLowerCase()) {
        return {
          ok: false,
          stagedVersion: null,
          stagedArtifactPath: null,
          errorMessage: 'Checksum SHA256 do update nao confere com o manifesto.'
        };
      }

      const fileName = safeFileNameFromUrl(manifest.downloadUrl);
      const targetDir = path.join(this.downloadDir, sanitizePathSegment(manifest.version));
      fs.mkdirSync(targetDir, { recursive: true });
      const artifactPath = path.join(targetDir, fileName);
      fs.writeFileSync(artifactPath, bytes);
      fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      return {
        ok: true,
        stagedVersion: manifest.version,
        stagedArtifactPath: artifactPath,
        errorMessage: null
      };
    } catch (error) {
      return {
        ok: false,
        stagedVersion: null,
        stagedArtifactPath: null,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async fetchReleases(): Promise<GitHubRelease[]> {
    const url = `${this.apiBaseUrl}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/releases?per_page=15`;
    const json = await this.fetchJson(url);
    return Array.isArray(json) ? (json as GitHubRelease[]) : [];
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': this.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API respondeu HTTP ${response.status} para ${url}`);
    }

    return response.json();
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        Accept: '*/*',
        'User-Agent': this.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} para ${url}`);
    }

    return response.text();
  }

  private async verifyManifestSignatureIfConfigured(release: GitHubRelease, manifestText: string): Promise<boolean> {
    if (!this.manifestPublicKeyPem) {
      return true;
    }

    const signatureAsset = (release.assets ?? []).find((asset) => asset.name === this.manifestSignatureAssetName);
    if (!signatureAsset?.browser_download_url) {
      return false;
    }

    return verifyEd25519DetachedSignature({
      manifestText,
      signatureBase64Promise: this.fetchText(signatureAsset.browser_download_url),
      publicKeyPem: this.manifestPublicKeyPem
    });
  }
}

function parseJsonSafe(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function verifyEd25519DetachedSignature(input: {
  manifestText: string;
  signatureBase64Promise: Promise<string>;
  publicKeyPem: string;
}): Promise<boolean> {
  try {
    const signatureBase64 = await input.signatureBase64Promise;
    const signature = parseBase64Signature(signatureBase64);
    if (!signature) {
      return false;
    }

    return crypto.verify(null, Buffer.from(input.manifestText, 'utf8'), input.publicKeyPem, signature);
  } catch {
    return false;
  }
}

function parseBase64Signature(value: string): Buffer | null {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) {
    return null;
  }

  try {
    const bytes = Buffer.from(normalized, 'base64');
    if (bytes.length === 0) {
      return null;
    }

    return bytes;
  } catch {
    return null;
  }
}

function isCandidateRelease(release: GitHubRelease, channel: UpdateCheckInput['channel']): boolean {
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

function normalizeTagToVersion(tagName: string | undefined): string | null {
  if (typeof tagName !== 'string' || !tagName.trim()) {
    return null;
  }

  const normalized = tagName.trim();
  return normalized.startsWith('v') ? normalized.slice(1) : normalized;
}

interface VersionKey {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersionKey(value: string): VersionKey | null {
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

function compareVersionKeys(left: VersionKey, right: VersionKey): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) {
    return 1;
  }
  if (left.prerelease.length > 0 && right.prerelease.length === 0) {
    return -1;
  }

  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < max; i += 1) {
    const a = left.prerelease[i];
    const b = right.prerelease[i];
    if (a === undefined) {
      return -1;
    }
    if (b === undefined) {
      return 1;
    }
    if (a === b) {
      continue;
    }

    const aNum = /^\d+$/.test(a) ? Number(a) : null;
    const bNum = /^\d+$/.test(b) ? Number(b) : null;
    if (aNum !== null && bNum !== null) {
      return aNum - bNum;
    }
    if (aNum !== null) {
      return -1;
    }
    if (bNum !== null) {
      return 1;
    }
    return a.localeCompare(b);
  }

  return 0;
}

function safeFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = path.basename(parsed.pathname);
    return sanitizePathSegment(name || 'dexter-update.bin');
  } catch {
    return 'dexter-update.bin';
  }
}

function sanitizePathSegment(value: string): string {
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return safe || 'file';
}
