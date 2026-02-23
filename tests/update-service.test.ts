import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateManifest } from '@shared/contracts';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';
import { UpdatePolicyStore } from '@main/services/update/UpdatePolicyStore';
import { UpdateService } from '@main/services/update/UpdateService';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('UpdateService', () => {
  it('marca update disponivel e depois staged apos download', async () => {
    const { service, provider } = createService({
      manifest: buildManifest('0.1.4')
    });

    const checked = await service.checkForUpdates();
    expect(checked.phase).toBe('available');
    expect(checked.available?.version).toBe('0.1.4');

    const downloaded = await service.downloadUpdate();
    expect(downloaded.phase).toBe('staged');
    expect(downloaded.stagedVersion).toBe('0.1.4');
    expect(downloaded.stagedArtifactPath).toContain('/tmp/');
    expect(provider.download).toHaveBeenCalledTimes(1);
  });

  it('ignora prerelease quando canal e stable', async () => {
    const { service } = createService({
      manifest: buildManifest('0.1.4-rc.1', 'rc')
    });

    const state = await service.checkForUpdates();
    expect(state.phase).toBe('up-to-date');
    expect(state.available).toBeNull();
  });

  it('bloqueia update incompativel por contrato/schema', async () => {
    const manifest = buildManifest('0.1.4');
    manifest.compatibility.ipcContractCompatible = false;

    const { service, logger } = createService({ manifest });
    const state = await service.checkForUpdates();

    expect(state.phase).toBe('error');
    expect(state.lastError).toContain('bloqueado');
    expect(state.lastError).toContain('IPC');
    expect(state.lastErrorCode).toBe('ipc_incompatible');
    expect(logger.warn).toHaveBeenCalledWith(
      'update.check.incompatible',
      expect.objectContaining({
        version: '0.1.4',
        reason: expect.stringContaining('IPC')
      })
    );
  });

  it('bloqueia update quando schema alvo nao e migravel localmente', async () => {
    const manifest = buildManifest('0.1.4');
    manifest.components.userDataSchemaVersion = 3;
    manifest.compatibility.userDataSchemaCompatible = true;

    const { service, provider } = createService({ manifest, migrationPlanner: new UpdateMigrationPlanner() });
    const state = await service.checkForUpdates();

    expect(state.phase).toBe('error');
    expect(state.lastError).toContain('migracao');
    expect(state.lastError).toContain('2 -> 3');
    expect(state.lastErrorCode).toBe('schema_migration_unavailable');

    const downloadAttempt = await service.downloadUpdate();
    expect(downloadAttempt.phase).toBe('error');
    expect(downloadAttempt.lastErrorCode).toBe('schema_migration_unavailable');
    expect(provider.download).not.toHaveBeenCalled();
  });

  it('retorna erro previsivel quando provider falha no check', async () => {
    const { service, logger } = createService({
      checkError: 'offline'
    });

    const state = await service.checkForUpdates();
    expect(state.phase).toBe('error');
    expect(state.lastError).toContain('offline');
    expect(state.lastErrorCode).toBe('check_failed');
    expect(logger.error).toHaveBeenCalledWith(
      'update.check.error',
      expect.objectContaining({
        reason: 'offline',
        code: 'check_failed'
      })
    );
  });

  it('solicita reinicio quando existe update staged', async () => {
    const onRestart = vi.fn();
    const { service, stateStore, logger } = createService({
      manifest: null,
      onRestart
    });
    stateStore.patch({
      phase: 'staged',
      provider: 'mock',
      stagedVersion: '0.1.4',
      stagedArtifactPath: '/tmp/dexter-updates/0.1.4/dexter-0.1.4.AppImage',
      lastError: null
    });

    const result = service.restartToApplyUpdate();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('0.1.4');
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.restart_requested',
      expect.objectContaining({
        version: '0.1.4'
      })
    );
  });

  it('falha de forma previsivel se nao houver update staged para reiniciar', () => {
    const { service } = createService({});

    const result = service.restartToApplyUpdate();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Nenhum update staged');
    expect(result.state.phase).toBe('error');
    expect(result.state.lastErrorCode).toBe('no_staged_update');
  });

  it('nao executa novo check quando ja existe update staged', async () => {
    const { service, provider, stateStore } = createService({
      manifest: buildManifest('0.1.5')
    });
    stateStore.patch({
      phase: 'staged',
      provider: 'mock',
      stagedVersion: '0.1.4',
      stagedArtifactPath: '/tmp/dexter-updates/0.1.4/dexter-0.1.4.AppImage',
      lastError: null
    });

    const state = await service.checkForUpdates();
    expect(state.phase).toBe('staged');
    expect(state.stagedVersion).toBe('0.1.4');
    expect(provider.checkLatest).not.toHaveBeenCalled();
  });
});

function createService(options: {
  manifest?: UpdateManifest | null;
  checkError?: string;
  onRestart?: () => void;
  migrationPlanner?: UpdateMigrationPlanner;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-update-service-'));
  tempDirs.push(dir);

  const policyStore = new UpdatePolicyStore(dir);
  const stateStore = new UpdateStateStore(dir);

  const provider = {
    kind: 'mock' as const,
    checkLatest: vi.fn(async () => {
      if (options.checkError) {
        throw new Error(options.checkError);
      }

      return options.manifest ?? null;
    }),
    download: vi.fn(async (manifest: UpdateManifest) => ({
      ok: true,
      stagedVersion: manifest.version,
      stagedArtifactPath: `/tmp/dexter-updates/${manifest.version}/dexter-${manifest.version}.AppImage`,
      errorMessage: null
    }))
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  const service = new UpdateService(policyStore, stateStore, provider as never, logger as never, {
    appVersion: '0.1.3',
    coreVersion: '0.1.3',
    uiVersion: '0.1.3',
    ipcContractVersion: 1,
    userDataSchemaVersion: 1
  }, options.onRestart, options.migrationPlanner);

  return {
    service,
    provider,
    logger,
    stateStore
  };
}

function buildManifest(version: string, channel: 'stable' | 'rc' = 'stable'): UpdateManifest {
  return {
    version,
    channel,
    provider: 'mock',
    publishedAt: new Date().toISOString(),
    releaseNotes: 'release notes',
    downloadUrl: `https://example.invalid/${version}`,
    checksumSha256: 'sha',
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
