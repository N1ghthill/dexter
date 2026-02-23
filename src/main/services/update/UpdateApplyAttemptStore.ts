import fs from 'node:fs';
import path from 'node:path';
import type { UpdateApplyLaunchResult } from '@main/services/update/UpdateApplier';

export interface UpdateApplyAttemptRecord {
  targetVersion: string;
  previousVersion: string;
  mode: UpdateApplyLaunchResult['mode'];
  packageType: 'appimage' | 'deb' | 'unknown';
  stagedArtifactPath: string | null;
  rollbackArtifactPath: string | null;
  createdAt: string;
}

interface PersistedApplyAttemptFile {
  pending: UpdateApplyAttemptRecord | null;
}

export class UpdateApplyAttemptStore {
  private readonly filePath: string;
  private cache: UpdateApplyAttemptRecord | null;

  constructor(baseDir: string) {
    const updateDir = path.join(baseDir, 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    this.filePath = path.join(updateDir, 'apply-attempt.json');
    this.cache = this.load();
  }

  get(): UpdateApplyAttemptRecord | null {
    return this.cache ? cloneRecord(this.cache) : null;
  }

  set(record: UpdateApplyAttemptRecord): UpdateApplyAttemptRecord {
    this.cache = normalizeRecord(record);
    this.persist(this.cache);
    return this.get() as UpdateApplyAttemptRecord;
  }

  clear(): void {
    this.cache = null;
    this.persist(null);
  }

  private load(): UpdateApplyAttemptRecord | null {
    if (!fs.existsSync(this.filePath)) {
      this.persist(null);
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<PersistedApplyAttemptFile>;
      const normalized = normalizeRecord(parsed.pending);
      this.persist(normalized);
      return normalized;
    } catch {
      this.persist(null);
      return null;
    }
  }

  private persist(pending: UpdateApplyAttemptRecord | null): void {
    const payload: PersistedApplyAttemptFile = {
      pending
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}

function cloneRecord(record: UpdateApplyAttemptRecord): UpdateApplyAttemptRecord {
  return {
    ...record
  };
}

function normalizeRecord(value: unknown): UpdateApplyAttemptRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<UpdateApplyAttemptRecord>;
  if (
    typeof record.targetVersion !== 'string' ||
    typeof record.previousVersion !== 'string' ||
    !isMode(record.mode) ||
    !isPackageType(record.packageType) ||
    !isNullableString(record.stagedArtifactPath) ||
    !isNullableString(record.rollbackArtifactPath) ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) {
    return null;
  }

  return {
    targetVersion: record.targetVersion,
    previousVersion: record.previousVersion,
    mode: record.mode,
    packageType: record.packageType,
    stagedArtifactPath: record.stagedArtifactPath,
    rollbackArtifactPath: record.rollbackArtifactPath,
    createdAt: new Date(record.createdAt).toISOString()
  };
}

function isMode(value: unknown): value is UpdateApplyAttemptRecord['mode'] {
  return value === 'relaunch' || value === 'linux-appimage' || value === 'linux-deb-assist' || value === 'linux-deb-pkexec';
}

function isPackageType(value: unknown): value is UpdateApplyAttemptRecord['packageType'] {
  return value === 'appimage' || value === 'deb' || value === 'unknown';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

