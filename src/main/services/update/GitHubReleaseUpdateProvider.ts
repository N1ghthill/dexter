import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateArtifact, UpdateArtifactPackageType, UpdateManifest } from '@shared/contracts';
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
  platform?: NodeJS.Platform;
  arch?: string;
  executablePath?: string;
  packageTypePreference?: UpdateArtifactPackageType[];
  maxStagedVersionsToKeep?: number;
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
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly executablePath: string;
  private readonly packageTypePreference: UpdateArtifactPackageType[];
  private readonly maxStagedVersionsToKeep: number;
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
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.executablePath = options.executablePath ?? process.execPath;
    this.packageTypePreference = normalizePackageTypePreference(options.packageTypePreference, this.executablePath);
    this.maxStagedVersionsToKeep = normalizeMaxStagedVersionsToKeep(options.maxStagedVersionsToKeep);
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

      const manifest = selectManifestArtifactForRuntime(validated.manifest, {
        platform: this.platform,
        arch: this.arch,
        executablePath: this.executablePath,
        packageTypePreference: this.packageTypePreference
      });
      if (!manifest) {
        continue;
      }
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
      const artifact = resolveDownloadArtifact(manifest);
      if (!artifact) {
        return {
          ok: false,
          stagedVersion: null,
          stagedArtifactPath: null,
          errorMessage: 'Manifesto nao possui artefato compativel para este ambiente.'
        };
      }

      const response = await fetch(artifact.downloadUrl, {
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
      if (digest.toLowerCase() !== artifact.checksumSha256.toLowerCase()) {
        return {
          ok: false,
          stagedVersion: null,
          stagedArtifactPath: null,
          errorMessage: 'Checksum SHA256 do update nao confere com o manifesto.'
        };
      }

      const fileName = safeFileNameFromUrl(artifact.downloadUrl);
      const targetDir = path.join(this.downloadDir, sanitizePathSegment(manifest.version));
      fs.mkdirSync(targetDir, { recursive: true });
      const artifactPath = path.join(targetDir, fileName);
      fs.writeFileSync(artifactPath, bytes);
      fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      pruneOldStagedDownloads(this.downloadDir, {
        keepVersion: manifest.version,
        maxVersionsToKeep: this.maxStagedVersionsToKeep
      });

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

function normalizePackageTypePreference(
  input: UpdateArtifactPackageType[] | undefined,
  executablePath: string
): UpdateArtifactPackageType[] {
  const valid = new Set<UpdateArtifactPackageType>();
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item === 'appimage' || item === 'deb') {
        valid.add(item);
      }
    }
  }

  if (valid.size > 0) {
    return Array.from(valid);
  }

  const execLower = executablePath.toLowerCase();
  if (execLower.endsWith('.appimage')) {
    return ['appimage', 'deb'];
  }

  return ['deb', 'appimage'];
}

function normalizeMaxStagedVersionsToKeep(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 3;
  }

  return Math.max(1, Math.trunc(value ?? 3));
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

function selectManifestArtifactForRuntime(
  manifest: UpdateManifest,
  runtime: {
    platform: NodeJS.Platform;
    arch: string;
    executablePath: string;
    packageTypePreference: UpdateArtifactPackageType[];
  }
): UpdateManifest | null {
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    const inferred = inferLegacyArtifact(manifest, runtime);
    if (!inferred) {
      return manifest;
    }

    return {
      ...manifest,
      selectedArtifact: inferred
    };
  }

  const targetPlatform = mapNodePlatform(runtime.platform);
  const targetArch = mapNodeArch(runtime.arch);
  if (!targetPlatform || !targetArch) {
    return null;
  }

  const compatible = manifest.artifacts.filter(
    (artifact) => artifact.platform === targetPlatform && artifact.arch === targetArch
  );
  if (compatible.length === 0) {
    return null;
  }

  const selected =
    pickPreferredArtifact(compatible, runtime.packageTypePreference) ??
    compatible.find((artifact) => artifact.packageType === 'appimage') ??
    compatible[0];
  if (!selected) {
    return null;
  }

  return {
    ...manifest,
    // Keep legacy fields aligned with the chosen artifact for downstream compatibility.
    downloadUrl: selected.downloadUrl,
    checksumSha256: selected.checksumSha256,
    selectedArtifact: { ...selected }
  };
}

function inferLegacyArtifact(
  manifest: Pick<UpdateManifest, 'downloadUrl' | 'checksumSha256'>,
  runtime: { platform: NodeJS.Platform; arch: string }
): UpdateArtifact | null {
  const packageType = inferPackageTypeFromUrl(manifest.downloadUrl);
  const platform = mapNodePlatform(runtime.platform);
  const arch = mapNodeArch(runtime.arch);
  if (!packageType || !platform || !arch) {
    return null;
  }

  return {
    platform,
    arch,
    packageType,
    downloadUrl: manifest.downloadUrl,
    checksumSha256: manifest.checksumSha256
  };
}

function resolveDownloadArtifact(
  manifest: UpdateManifest
): Pick<UpdateArtifact, 'downloadUrl' | 'checksumSha256'> | null {
  if (manifest.selectedArtifact) {
    return manifest.selectedArtifact;
  }

  if (typeof manifest.downloadUrl === 'string' && typeof manifest.checksumSha256 === 'string') {
    return {
      downloadUrl: manifest.downloadUrl,
      checksumSha256: manifest.checksumSha256
    };
  }

  return null;
}

function mapNodePlatform(value: NodeJS.Platform): UpdateArtifact['platform'] | null {
  return value === 'linux' ? 'linux' : null;
}

function mapNodeArch(value: string): UpdateArtifact['arch'] | null {
  return value === 'x64' || value === 'arm64' ? value : null;
}

function inferPackageTypeFromUrl(url: string): UpdateArtifactPackageType | null {
  const lower = url.toLowerCase();
  if (lower.endsWith('.appimage')) {
    return 'appimage';
  }
  if (lower.endsWith('.deb')) {
    return 'deb';
  }

  try {
    const parsed = new URL(url);
    const pathLower = parsed.pathname.toLowerCase();
    if (pathLower.endsWith('.appimage')) {
      return 'appimage';
    }
    if (pathLower.endsWith('.deb')) {
      return 'deb';
    }
  } catch {
    // ignore
  }

  return null;
}

function pickPreferredArtifact(
  artifacts: UpdateArtifact[],
  preference: UpdateArtifactPackageType[]
): UpdateArtifact | null {
  for (const packageType of preference) {
    const match = artifacts.find((artifact) => artifact.packageType === packageType);
    if (match) {
      return match;
    }
  }

  return null;
}

function pruneOldStagedDownloads(
  rootDir: string,
  options: {
    keepVersion: string;
    maxVersionsToKeep: number;
  }
): void {
  try {
    if (!fs.existsSync(rootDir)) {
      return;
    }

    const entries = fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(rootDir, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return {
          name: entry.name,
          fullPath,
          mtimeMs
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const keep = new Set<string>([options.keepVersion]);
    for (const entry of entries) {
      if (keep.size >= options.maxVersionsToKeep) {
        break;
      }
      keep.add(entry.name);
    }

    for (const entry of entries) {
      if (keep.has(entry.name)) {
        continue;
      }
      fs.rmSync(entry.fullPath, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup; never fail staging due to retention cleanup.
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
