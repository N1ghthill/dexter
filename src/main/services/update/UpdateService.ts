import type {
  ComponentVersionSet,
  UpdateErrorCode,
  UpdateManifest,
  UpdatePolicy,
  UpdatePolicyPatch,
  UpdateRestartResult,
  UpdateState
} from '@shared/contracts';
import { Logger } from '@main/services/logging/Logger';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';
import type { UpdateProvider } from '@main/services/update/UpdateProvider';
import { UpdatePolicyStore } from '@main/services/update/UpdatePolicyStore';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';

export class UpdateService {
  constructor(
    private readonly policyStore: UpdatePolicyStore,
    private readonly stateStore: UpdateStateStore,
    private readonly provider: UpdateProvider,
    private readonly logger: Logger,
    private readonly currentComponents: ComponentVersionSet,
    private readonly requestRestart?: (state: UpdateState) => void,
    private readonly migrationPlanner?: UpdateMigrationPlanner
  ) {}

  getState(): UpdateState {
    const state = this.stateStore.get();
    if (state.provider !== this.provider.kind) {
      return this.stateStore.patch({ provider: this.provider.kind });
    }

    return state;
  }

  getPolicy(): UpdatePolicy {
    return this.policyStore.get();
  }

  setPolicy(patch: UpdatePolicyPatch): UpdatePolicy {
    return this.policyStore.set(patch);
  }

  async checkForUpdates(): Promise<UpdateState> {
    const currentState = this.stateStore.get();
    if (currentState.phase === 'staged' && currentState.stagedVersion) {
      this.logger.info('update.check.skipped_staged', {
        provider: this.provider.kind,
        stagedVersion: currentState.stagedVersion
      });
      return currentState;
    }

    const policy = this.policyStore.get();
    this.logger.info('update.check.start', {
      provider: this.provider.kind,
      channel: policy.channel,
      currentVersion: this.currentComponents.appVersion
    });

    this.stateStore.patch({
      phase: 'checking',
      provider: this.provider.kind,
      lastError: null,
      lastErrorCode: null
    });

    try {
      const manifest = await this.provider.checkLatest({
        channel: policy.channel,
        currentVersion: this.currentComponents.appVersion,
        currentComponents: this.currentComponents
      });
      const checkedAt = new Date().toISOString();

      if (!manifest || !isNewerVersion(manifest.version, this.currentComponents.appVersion) || isFilteredByPolicy(manifest, policy)) {
        const result = this.stateStore.patch({
          phase: 'up-to-date',
          provider: this.provider.kind,
          checkedAt,
          lastError: null,
          lastErrorCode: null,
          available: null,
          stagedVersion: null,
          stagedArtifactPath: null
        });
        this.logger.info('update.check.finish', {
          provider: this.provider.kind,
          outcome: 'up-to-date'
        });
        return result;
      }

      const compatibility = this.evaluateCompatibility(manifest);
      if (!compatibility.ok) {
        const message = compatibility.reason
          ? `Update disponivel, mas bloqueado: ${compatibility.reason}`
          : 'Update disponivel, mas bloqueado por incompatibilidade de contrato/schema.';
        const result = this.stateStore.patch({
          phase: 'error',
          provider: this.provider.kind,
          checkedAt,
          lastError: message,
          lastErrorCode: compatibility.code,
          available: manifest,
          stagedVersion: null,
          stagedArtifactPath: null
        });
        this.logger.warn('update.check.incompatible', {
          version: manifest.version,
          strategy: manifest.compatibility.strategy,
          code: compatibility.code,
          reason: compatibility.reason,
          localUserDataSchemaVersion: this.currentComponents.userDataSchemaVersion,
          targetUserDataSchemaVersion: manifest.components.userDataSchemaVersion
        });
        this.logger.info('update.check.finish', {
          provider: this.provider.kind,
          outcome: 'blocked'
        });
        return result;
      }

      const result = this.stateStore.patch({
        phase: 'available',
        provider: this.provider.kind,
        checkedAt,
        lastError: null,
        lastErrorCode: null,
        available: manifest,
        stagedVersion: null,
        stagedArtifactPath: null
      });
      this.logger.info('update.check.finish', {
        provider: this.provider.kind,
        outcome: 'available',
        version: manifest.version
      });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('update.check.error', {
        provider: this.provider.kind,
        reason,
        code: 'check_failed'
      });
      return this.stateStore.patch({
        phase: 'error',
        provider: this.provider.kind,
        checkedAt: new Date().toISOString(),
        lastError: `Falha ao verificar updates: ${reason}`,
        lastErrorCode: 'check_failed',
        stagedVersion: null,
        stagedArtifactPath: null
      });
    }
  }

  async downloadUpdate(): Promise<UpdateState> {
    const current = this.stateStore.get();
    if (current.phase === 'staged' && current.stagedVersion) {
      return current;
    }

    if (isCompatibilityBlockedErrorCode(current.lastErrorCode) && current.available) {
      this.logger.info('update.download.skipped_blocked', {
        provider: this.provider.kind,
        version: current.available.version,
        code: current.lastErrorCode
      });
      return current;
    }

    if (!current.available) {
      return this.stateStore.patch({
        phase: 'error',
        provider: this.provider.kind,
        lastError: 'Nenhum update disponivel para download.',
        lastErrorCode: 'no_update_available_for_download'
      });
    }

    this.logger.info('update.download.start', {
      provider: this.provider.kind,
      version: current.available.version
    });

    this.stateStore.patch({
      phase: 'downloading',
      provider: this.provider.kind,
      lastError: null,
      lastErrorCode: null
    });

    try {
      const result = await this.provider.download(current.available);
      if (!result.ok || !result.stagedVersion) {
        const message = result.errorMessage || 'Falha ao baixar update.';
        this.logger.error('update.download.error', {
          provider: this.provider.kind,
          version: current.available.version,
          reason: message,
          code: 'download_failed'
        });
        return this.stateStore.patch({
          phase: 'error',
          provider: this.provider.kind,
          lastError: message,
          lastErrorCode: 'download_failed',
          stagedVersion: null,
          stagedArtifactPath: null
        });
      }

      this.logger.info('update.download.finish', {
        provider: this.provider.kind,
        version: result.stagedVersion
      });

      return this.stateStore.patch({
        phase: 'staged',
        provider: this.provider.kind,
        stagedVersion: result.stagedVersion,
        stagedArtifactPath: result.stagedArtifactPath,
        lastError: null,
        lastErrorCode: null
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('update.download.error', {
        provider: this.provider.kind,
        version: current.available.version,
        reason,
        code: 'download_failed'
      });
      return this.stateStore.patch({
        phase: 'error',
        provider: this.provider.kind,
        lastError: `Falha ao baixar update: ${reason}`,
        lastErrorCode: 'download_failed',
        stagedVersion: null,
        stagedArtifactPath: null
      });
    }
  }

  restartToApplyUpdate(): UpdateRestartResult {
    const current = this.stateStore.get();
    if (current.phase !== 'staged' || !current.stagedVersion) {
      const state = this.stateStore.patch({
        phase: 'error',
        provider: this.provider.kind,
        lastError: 'Nenhum update staged para aplicar no reinicio.',
        lastErrorCode: 'no_staged_update'
      });

      return {
        ok: false,
        message: state.lastError || 'Nenhum update staged para aplicar no reinicio.',
        state
      };
    }

    if (!this.requestRestart) {
      const message = 'Reinicio programatico nao configurado neste ambiente.';
      const state = this.stateStore.patch({
        phase: 'staged',
        provider: this.provider.kind,
        lastError: message,
        lastErrorCode: 'restart_unavailable'
      });

      this.logger.warn('update.apply.restart_unavailable', {
        provider: this.provider.kind,
        version: current.stagedVersion,
        code: 'restart_unavailable'
      });

      return {
        ok: false,
        message,
        state
      };
    }

    const state = this.stateStore.patch({
      phase: 'staged',
      provider: this.provider.kind,
      lastError: null,
      lastErrorCode: null
    });

    try {
      this.logger.info('update.apply.restart_requested', {
        provider: this.provider.kind,
        version: current.stagedVersion
      });
      this.requestRestart(state);

      return {
        ok: true,
        message: `Reinicio solicitado para aplicar update ${current.stagedVersion}.`,
        state
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = `Falha ao solicitar reinicio: ${reason}`;
      this.logger.error('update.apply.restart_error', {
        provider: this.provider.kind,
        version: current.stagedVersion,
        reason,
        code: 'restart_failed'
      });

      return {
        ok: false,
        message,
        state: this.stateStore.patch({
          phase: 'staged',
          provider: this.provider.kind,
          lastError: message,
          lastErrorCode: 'restart_failed'
        })
      };
    }
  }

  private evaluateCompatibility(
    manifest: UpdateManifest
  ): { ok: true } | { ok: false; code: Extract<UpdateErrorCode, 'ipc_incompatible' | 'remote_schema_incompatible' | 'schema_migration_unavailable'>; reason: string } {
    if (!manifest.compatibility.ipcContractCompatible) {
      return {
        ok: false,
        code: 'ipc_incompatible',
        reason: 'contrato IPC incompativel com a versao atual.'
      };
    }

    if (!manifest.compatibility.userDataSchemaCompatible) {
      return {
        ok: false,
        code: 'remote_schema_incompatible',
        reason: 'manifesto remoto marcou schema de dados como incompativel.'
      };
    }

    if (!this.migrationPlanner) {
      return { ok: true };
    }

    const migrationPlan = this.migrationPlanner.plan(
      this.currentComponents.userDataSchemaVersion,
      manifest.components.userDataSchemaVersion
    );
    if (!migrationPlan.supported) {
      return {
        ok: false,
        code: 'schema_migration_unavailable',
        reason:
          migrationPlan.blockedReason ||
          `migracao de schema indisponivel (${migrationPlan.fromVersion} -> ${migrationPlan.toVersion}).`
      };
    }

    return { ok: true };
  }
}

function isCompatibilityBlockedErrorCode(code: UpdateState['lastErrorCode']): boolean {
  return code === 'ipc_incompatible' || code === 'remote_schema_incompatible' || code === 'schema_migration_unavailable';
}

function isFilteredByPolicy(manifest: UpdateManifest, policy: UpdatePolicy): boolean {
  return policy.channel === 'stable' && isPrerelease(manifest.version);
}

function isPrerelease(version: string): boolean {
  return version.includes('-');
}

function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (!a || !b) {
    return candidate !== current;
  }

  if (a.major !== b.major) {
    return a.major > b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor > b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch > b.patch;
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) {
    return true;
  }
  if (a.prerelease.length > 0 && b.prerelease.length === 0) {
    return false;
  }

  const max = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < max; i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) {
      return false;
    }
    if (right === undefined) {
      return true;
    }
    if (left === right) {
      continue;
    }

    const leftNum = /^\d+$/.test(left) ? Number(left) : null;
    const rightNum = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNum !== null && rightNum !== null) {
      return leftNum > rightNum;
    }
    if (leftNum !== null) {
      return false;
    }
    if (rightNum !== null) {
      return true;
    }
    return left > right;
  }

  return false;
}

function parseSemver(value: string): { major: number; minor: number; patch: number; prerelease: string[] } | null {
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
