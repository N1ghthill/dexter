import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@main/services/logging/Logger';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';

interface UpdateStartupReconcilerOptions {
  userDataDir: string;
  currentAppVersion: string;
  stateStore: UpdateStateStore;
  logger: Logger;
  rmSync?: (targetPath: string, options?: fs.RmOptions) => void;
}

export class UpdateStartupReconciler {
  private readonly userDataDir: string;
  private readonly currentAppVersion: string;
  private readonly stateStore: UpdateStateStore;
  private readonly logger: Logger;
  private readonly rmSync: (targetPath: string, options?: fs.RmOptions) => void;

  constructor(options: UpdateStartupReconcilerOptions) {
    this.userDataDir = options.userDataDir;
    this.currentAppVersion = options.currentAppVersion;
    this.stateStore = options.stateStore;
    this.logger = options.logger;
    this.rmSync = options.rmSync ?? fs.rmSync;
  }

  reconcile(): void {
    const state = this.stateStore.get();
    if (state.phase !== 'staged' || !state.stagedVersion) {
      return;
    }

    const cmp = compareVersions(this.currentAppVersion, state.stagedVersion);
    if (cmp === null || cmp < 0) {
      this.logger.info('update.startup.staged_pending', {
        currentVersion: this.currentAppVersion,
        stagedVersion: state.stagedVersion,
        comparable: cmp !== null
      });
      return;
    }

    const cleanup = cleanupStagedArtifactPath({
      userDataDir: this.userDataDir,
      stagedArtifactPath: state.stagedArtifactPath,
      rmSync: this.rmSync
    });

    this.stateStore.patch({
      phase: 'idle',
      available: null,
      stagedVersion: null,
      stagedArtifactPath: null,
      lastError: null,
      lastErrorCode: null
    });

    this.logger.info('update.startup.staged_reconciled', {
      currentVersion: this.currentAppVersion,
      stagedVersion: state.stagedVersion,
      outcome: cmp === 0 ? 'applied' : 'superseded',
      stagedArtifactPath: state.stagedArtifactPath,
      cleanup
    });
  }
}

function cleanupStagedArtifactPath(input: {
  userDataDir: string;
  stagedArtifactPath: string | null;
  rmSync: (targetPath: string, options?: fs.RmOptions) => void;
}): {
  attempted: boolean;
  removedTarget: string | null;
  scope: 'none' | 'downloads-version-dir' | 'artifact-file';
  ok: boolean;
  reason?: string;
} {
  const artifactPath = typeof input.stagedArtifactPath === 'string' ? input.stagedArtifactPath.trim() : '';
  if (!artifactPath) {
    return {
      attempted: false,
      removedTarget: null,
      scope: 'none',
      ok: true
    };
  }

  const downloadsRoot = path.resolve(input.userDataDir, 'updates', 'downloads');
  const resolvedArtifactPath = path.resolve(artifactPath);
  if (!isPathInside(downloadsRoot, resolvedArtifactPath)) {
    return {
      attempted: false,
      removedTarget: null,
      scope: 'none',
      ok: true,
      reason: 'outside_downloads_root'
    };
  }

  const artifactDir = path.dirname(resolvedArtifactPath);
  const parentName = path.basename(artifactDir);
  const target =
    parentName && isLikelyVersionDir(parentName) && isPathInside(downloadsRoot, artifactDir) ? artifactDir : resolvedArtifactPath;
  const scope = target === artifactDir ? 'downloads-version-dir' : 'artifact-file';

  try {
    input.rmSync(target, { recursive: true, force: true });
    return {
      attempted: true,
      removedTarget: target,
      scope,
      ok: true
    };
  } catch (error) {
    return {
      attempted: true,
      removedTarget: target,
      scope,
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function isPathInside(rootDir: string, candidatePath: string): boolean {
  const rel = path.relative(rootDir, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isLikelyVersionDir(name: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(name);
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    return null;
  }

  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) {
    return 1;
  }
  if (a.prerelease.length > 0 && b.prerelease.length === 0) {
    return -1;
  }

  const size = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < size; index += 1) {
    const leftId = a.prerelease[index];
    const rightId = b.prerelease[index];
    if (leftId === undefined) {
      return -1;
    }
    if (rightId === undefined) {
      return 1;
    }
    if (leftId === rightId) {
      continue;
    }

    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      return Number(leftId) - Number(rightId);
    }
    if (leftNumeric && !rightNumeric) {
      return -1;
    }
    if (!leftNumeric && rightNumeric) {
      return 1;
    }
    return leftId.localeCompare(rightId);
  }

  return 0;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
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

