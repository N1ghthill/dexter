import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Logger } from '@main/services/logging/Logger';
import type { UpdateApplyLaunchResult } from '@main/services/update/UpdateApplier';
import { UpdateApplyAttemptStore, type UpdateApplyAttemptRecord } from '@main/services/update/UpdateApplyAttemptStore';
import type { UpdateState } from '@shared/contracts';

interface UpdatePostApplyCoordinatorOptions {
  userDataDir: string;
  currentAppVersion: string;
  logger: Logger;
  attemptStore: UpdateApplyAttemptStore;
  autoDebRollbackOnBootFailure?: boolean;
  requireBootHealthyHandshake?: boolean;
  bootHealthyGraceMs?: number;
  bootHealthyStabilityMs?: number;
  spawnFn?: typeof spawn;
  setTimeoutFn?: (fn: () => void, delayMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export class UpdatePostApplyCoordinator {
  private readonly userDataDir: string;
  private readonly currentAppVersion: string;
  private readonly logger: Logger;
  private readonly attemptStore: UpdateApplyAttemptStore;
  private readonly autoDebRollbackOnBootFailure: boolean;
  private readonly requireBootHealthyHandshake: boolean;
  private readonly bootHealthyGraceMs: number;
  private readonly bootHealthyStabilityMs: number;
  private readonly spawnFn: typeof spawn;
  private readonly setTimeoutFn: (fn: () => void, delayMs: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private pendingHealthTimeoutHandle: unknown | null = null;
  private pendingStabilityTimeoutHandle: unknown | null = null;

  constructor(options: UpdatePostApplyCoordinatorOptions) {
    this.userDataDir = options.userDataDir;
    this.currentAppVersion = options.currentAppVersion;
    this.logger = options.logger;
    this.attemptStore = options.attemptStore;
    this.autoDebRollbackOnBootFailure = options.autoDebRollbackOnBootFailure === true;
    this.requireBootHealthyHandshake = options.requireBootHealthyHandshake === true;
    this.bootHealthyGraceMs = normalizeGraceMs(options.bootHealthyGraceMs);
    this.bootHealthyStabilityMs = normalizeStabilityMs(options.bootHealthyStabilityMs);
    this.spawnFn = options.spawnFn ?? spawn;
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, delayMs) => setTimeout(fn, delayMs));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  recordApplyAttempt(state: UpdateState, launch: UpdateApplyLaunchResult): void {
    if (!state.stagedVersion) {
      return;
    }

    const packageType = inferPackageType(state.stagedArtifactPath);
    const rollbackArtifactPath =
      packageType === 'deb' ? findDownloadedDebForVersion(this.userDataDir, this.currentAppVersion) : null;

    const record = this.attemptStore.set({
      targetVersion: state.stagedVersion,
      previousVersion: this.currentAppVersion,
      mode: launch.mode,
      packageType,
      stagedArtifactPath: normalizeOptionalPath(state.stagedArtifactPath),
      rollbackArtifactPath,
      createdAt: new Date().toISOString()
    });

    this.logger.info('update.apply.attempt_recorded', {
      targetVersion: record.targetVersion,
      previousVersion: record.previousVersion,
      mode: record.mode,
      packageType: record.packageType,
      rollbackAvailable: Boolean(record.rollbackArtifactPath)
    });
  }

  reconcileStartupSuccess(): void {
    const attempt = this.attemptStore.get();
    if (!attempt) {
      return;
    }

    const currentVsTarget = compareVersions(this.currentAppVersion, attempt.targetVersion);
    const currentVsPrevious = compareVersions(this.currentAppVersion, attempt.previousVersion);

    if (currentVsTarget === 0) {
      if (this.requireBootHealthyHandshake) {
        this.logger.info('update.apply.validation_waiting_health', {
          currentVersion: this.currentAppVersion,
          targetVersion: attempt.targetVersion,
          mode: attempt.mode,
          packageType: attempt.packageType,
          graceMs: this.bootHealthyGraceMs
        });
        this.armBootHealthTimeout();
        return;
      }

      this.logger.info('update.apply.validation_passed', {
        currentVersion: this.currentAppVersion,
        targetVersion: attempt.targetVersion,
        mode: attempt.mode,
        packageType: attempt.packageType
      });
      this.attemptStore.clear();
      return;
    }

    if (currentVsPrevious === 0) {
      this.logger.warn('update.apply.validation_not_applied', {
        currentVersion: this.currentAppVersion,
        targetVersion: attempt.targetVersion,
        previousVersion: attempt.previousVersion,
        mode: attempt.mode,
        packageType: attempt.packageType
      });
      this.attemptStore.clear();
      return;
    }

    this.logger.warn('update.apply.validation_unexpected_version', {
      currentVersion: this.currentAppVersion,
      targetVersion: attempt.targetVersion,
      previousVersion: attempt.previousVersion,
      mode: attempt.mode,
      packageType: attempt.packageType,
      comparableTarget: currentVsTarget !== null,
      comparablePrevious: currentVsPrevious !== null
    });
    this.attemptStore.clear();
  }

  markBootHealthy(source: 'renderer' | 'main' = 'renderer'): void {
    const attempt = this.attemptStore.get();
    if (!attempt) {
      return;
    }

    const currentVsTarget = compareVersions(this.currentAppVersion, attempt.targetVersion);
    if (currentVsTarget !== 0) {
      return;
    }

    this.clearBootHealthTimeout();
    this.logger.info('update.apply.validation_healthy', {
      source,
      currentVersion: this.currentAppVersion,
      targetVersion: attempt.targetVersion,
      mode: attempt.mode,
      packageType: attempt.packageType
    });
    if (this.bootHealthyStabilityMs > 0) {
      this.logger.info('update.apply.validation_waiting_stability', {
        source,
        currentVersion: this.currentAppVersion,
        targetVersion: attempt.targetVersion,
        stabilityMs: this.bootHealthyStabilityMs
      });
      this.armBootStabilityTimeout();
      return;
    }

    this.attemptStore.clear();
  }

  handleBootFailure(reason: string): void {
    this.clearBootHealthTimeout();
    this.clearBootStabilityTimeout();
    const attempt = this.attemptStore.get();
    if (!attempt) {
      return;
    }

    this.logger.error('update.apply.validation_boot_failed', {
      reason,
      currentVersion: this.currentAppVersion,
      targetVersion: attempt.targetVersion,
      previousVersion: attempt.previousVersion,
      mode: attempt.mode,
      packageType: attempt.packageType
    });

    if (!this.canAutoRollbackDeb(attempt)) {
      return;
    }

    const rollbackArtifactPath = attempt.rollbackArtifactPath as string;
    const args = ['apt', 'install', '-y', rollbackArtifactPath];
    try {
      const child = this.spawnFn('pkexec', args, {
        cwd: path.dirname(rollbackArtifactPath),
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
      });
      child.unref();
      observeChildSpawn(
        child,
        () => {
          this.logger.warn('update.rollback.deb_scheduled', {
            targetVersion: attempt.targetVersion,
            rollbackToVersion: attempt.previousVersion,
            rollbackArtifactPath
          });
          this.attemptStore.clear();
        },
        (error) => {
          this.logger.error('update.rollback.deb_schedule_error', {
            targetVersion: attempt.targetVersion,
            rollbackToVersion: attempt.previousVersion,
            rollbackArtifactPath,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      );
    } catch (error) {
      this.logger.error('update.rollback.deb_schedule_error', {
        targetVersion: attempt.targetVersion,
        rollbackToVersion: attempt.previousVersion,
        rollbackArtifactPath,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private canAutoRollbackDeb(
    attempt: UpdateApplyAttemptRecord
  ): attempt is UpdateApplyAttemptRecord & { rollbackArtifactPath: string } {
    if (!this.autoDebRollbackOnBootFailure) {
      return false;
    }
    if (attempt.packageType !== 'deb' || attempt.mode !== 'linux-deb-pkexec') {
      return false;
    }

    const currentVsTarget = compareVersions(this.currentAppVersion, attempt.targetVersion);
    if (currentVsTarget !== 0) {
      return false;
    }

    const rollbackArtifactPath = normalizeOptionalPath(attempt.rollbackArtifactPath);
    if (!rollbackArtifactPath || !rollbackArtifactPath.toLowerCase().endsWith('.deb')) {
      return false;
    }
    if (!isPathInside(path.resolve(this.userDataDir, 'updates', 'downloads'), path.resolve(rollbackArtifactPath))) {
      return false;
    }

    return true;
  }

  private armBootHealthTimeout(): void {
    this.clearBootHealthTimeout();
    this.pendingHealthTimeoutHandle = this.setTimeoutFn(() => {
      this.pendingHealthTimeoutHandle = null;
      this.logger.error('update.apply.validation_health_timeout', {
        currentVersion: this.currentAppVersion,
        graceMs: this.bootHealthyGraceMs
      });
      this.handleBootFailure(`timeout aguardando handshake de boot saudavel (${this.bootHealthyGraceMs}ms)`);
    }, this.bootHealthyGraceMs);
  }

  private clearBootHealthTimeout(): void {
    if (this.pendingHealthTimeoutHandle === null) {
      return;
    }
    this.clearTimeoutFn(this.pendingHealthTimeoutHandle);
    this.pendingHealthTimeoutHandle = null;
  }

  private armBootStabilityTimeout(): void {
    this.clearBootStabilityTimeout();
    this.pendingStabilityTimeoutHandle = this.setTimeoutFn(() => {
      this.pendingStabilityTimeoutHandle = null;
      const attempt = this.attemptStore.get();
      if (!attempt) {
        return;
      }

      const currentVsTarget = compareVersions(this.currentAppVersion, attempt.targetVersion);
      if (currentVsTarget !== 0) {
        return;
      }

      this.logger.info('update.apply.validation_stable', {
        currentVersion: this.currentAppVersion,
        targetVersion: attempt.targetVersion,
        stabilityMs: this.bootHealthyStabilityMs
      });
      this.attemptStore.clear();
    }, this.bootHealthyStabilityMs);
  }

  private clearBootStabilityTimeout(): void {
    if (this.pendingStabilityTimeoutHandle === null) {
      return;
    }
    this.clearTimeoutFn(this.pendingStabilityTimeoutHandle);
    this.pendingStabilityTimeoutHandle = null;
  }
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function inferPackageType(stagedArtifactPath: string | null): 'appimage' | 'deb' | 'unknown' {
  const filePath = normalizeOptionalPath(stagedArtifactPath);
  if (!filePath) {
    return 'unknown';
  }
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.appimage')) {
    return 'appimage';
  }
  if (lower.endsWith('.deb')) {
    return 'deb';
  }
  return 'unknown';
}

function findDownloadedDebForVersion(userDataDir: string, version: string): string | null {
  const versionDir = path.join(userDataDir, 'updates', 'downloads', version);
  try {
    const entries = fs
      .readdirSync(versionDir, { withFileTypes: true })
      .filter((entry: { isFile: () => boolean; name: string }) => entry.isFile() && entry.name.toLowerCase().endsWith('.deb'))
      .map((entry: { name: string }) => path.join(versionDir, entry.name))
      .sort();
    return entries[0] ?? null;
  } catch {
    return null;
  }
}

function isPathInside(rootDir: string, candidatePath: string): boolean {
  const rel = path.relative(rootDir, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
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
  for (let i = 0; i < size; i += 1) {
    const leftId = a.prerelease[i];
    const rightId = b.prerelease[i];
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

function observeChildSpawn(
  child: {
    once?: (event: 'spawn' | 'error', listener: (...args: unknown[]) => void) => unknown;
  },
  onSpawn: () => void,
  onError: (error: unknown) => void
): void {
  if (typeof child.once !== 'function') {
    onSpawn();
    return;
  }

  let settled = false;
  child.once('error', (error) => {
    if (settled) {
      return;
    }
    settled = true;
    onError(error);
  });
  child.once('spawn', () => {
    if (settled) {
      return;
    }
    settled = true;
    onSpawn();
  });
}

function normalizeGraceMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 15000;
  }
  return Math.max(1000, Math.trunc(value ?? 15000));
}

function normalizeStabilityMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value ?? 0));
}
