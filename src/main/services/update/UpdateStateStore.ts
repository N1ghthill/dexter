import fs from 'node:fs';
import path from 'node:path';
import type { UpdateErrorCode, UpdateManifest, UpdateState } from '@shared/contracts';

interface PersistedUpdateStateFile {
  state: UpdateState;
}

export class UpdateStateStore {
  private readonly filePath: string;
  private cache: UpdateState;

  constructor(baseDir: string) {
    const updateDir = path.join(baseDir, 'updates');
    fs.mkdirSync(updateDir, { recursive: true });
    this.filePath = path.join(updateDir, 'state.json');
    this.cache = this.load();
  }

  get(): UpdateState {
    return cloneState(this.cache);
  }

  set(next: UpdateState): UpdateState {
    this.cache = normalizeState(next);
    this.persist(this.cache);
    return this.get();
  }

  patch(patch: Partial<UpdateState>): UpdateState {
    return this.set({
      ...this.cache,
      ...patch
    });
  }

  reset(): UpdateState {
    return this.set(defaultState());
  }

  private load(): UpdateState {
    if (!fs.existsSync(this.filePath)) {
      const initial = defaultState();
      this.persist(initial);
      return initial;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedUpdateStateFile>;
      const normalized = normalizeState(parsed.state);
      this.persist(normalized);
      return normalized;
    } catch {
      const fallback = defaultState();
      this.persist(fallback);
      return fallback;
    }
  }

  private persist(state: UpdateState): void {
    const file: PersistedUpdateStateFile = { state };
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

function defaultState(): UpdateState {
  return {
    phase: 'idle',
    provider: 'none',
    checkedAt: null,
    lastError: null,
    lastErrorCode: null,
    available: null,
    stagedVersion: null,
    stagedArtifactPath: null
  };
}

function normalizeState(input: unknown): UpdateState {
  if (!input || typeof input !== 'object') {
    return defaultState();
  }

  const value = input as Partial<UpdateState>;
  const fallback = defaultState();

  return {
    phase: isPhase(value.phase) ? value.phase : fallback.phase,
    provider: isProvider(value.provider) ? value.provider : fallback.provider,
    checkedAt: isNullableIso(value.checkedAt) ? value.checkedAt : fallback.checkedAt,
    lastError: typeof value.lastError === 'string' || value.lastError === null ? value.lastError : fallback.lastError,
    lastErrorCode: isErrorCode(value.lastErrorCode) ? value.lastErrorCode : null,
    available: isUpdateManifest(value.available) ? cloneManifest(value.available) : null,
    stagedVersion: typeof value.stagedVersion === 'string' || value.stagedVersion === null ? value.stagedVersion : null,
    stagedArtifactPath:
      typeof value.stagedArtifactPath === 'string' || value.stagedArtifactPath === null ? value.stagedArtifactPath : null
  };
}

function cloneState(state: UpdateState): UpdateState {
  return {
    ...state,
    available: state.available ? cloneManifest(state.available) : null
  };
}

function cloneManifest(manifest: UpdateManifest): UpdateManifest {
  return {
    ...manifest,
    components: { ...manifest.components },
    compatibility: {
      ...manifest.compatibility,
      notes: manifest.compatibility.notes.slice()
    }
  };
}

function isPhase(value: unknown): value is UpdateState['phase'] {
  return (
    value === 'idle' ||
    value === 'checking' ||
    value === 'up-to-date' ||
    value === 'available' ||
    value === 'downloading' ||
    value === 'staged' ||
    value === 'error'
  );
}

function isProvider(value: unknown): value is UpdateState['provider'] {
  return value === 'none' || value === 'mock' || value === 'github';
}

function isErrorCode(value: unknown): value is UpdateErrorCode {
  return (
    value === 'check_failed' ||
    value === 'download_failed' ||
    value === 'restart_failed' ||
    value === 'restart_unavailable' ||
    value === 'no_update_available_for_download' ||
    value === 'no_staged_update' ||
    value === 'ipc_incompatible' ||
    value === 'remote_schema_incompatible' ||
    value === 'schema_migration_unavailable'
  );
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const manifest = value as Partial<UpdateManifest>;
  const components = manifest.components as Partial<UpdateManifest['components']> | undefined;
  const compatibility = manifest.compatibility as Partial<UpdateManifest['compatibility']> | undefined;

  return (
    typeof manifest.version === 'string' &&
    (manifest.channel === 'stable' || manifest.channel === 'rc') &&
    isProvider(manifest.provider) &&
    typeof manifest.publishedAt === 'string' &&
    Number.isFinite(Date.parse(manifest.publishedAt)) &&
    typeof manifest.releaseNotes === 'string' &&
    typeof manifest.downloadUrl === 'string' &&
    typeof manifest.checksumSha256 === 'string' &&
    typeof components?.appVersion === 'string' &&
    typeof components.coreVersion === 'string' &&
    typeof components.uiVersion === 'string' &&
    typeof components.ipcContractVersion === 'number' &&
    Number.isFinite(components.ipcContractVersion) &&
    typeof components.userDataSchemaVersion === 'number' &&
    Number.isFinite(components.userDataSchemaVersion) &&
    (compatibility?.strategy === 'atomic' || compatibility?.strategy === 'ui-only') &&
    typeof compatibility.requiresRestart === 'boolean' &&
    typeof compatibility.ipcContractCompatible === 'boolean' &&
    typeof compatibility.userDataSchemaCompatible === 'boolean' &&
    Array.isArray(compatibility.notes) &&
    compatibility.notes.every((item) => typeof item === 'string')
  );
}
