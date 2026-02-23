import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@shared/contracts';
import { UpdateStateStore } from '@main/services/update/UpdateStateStore';
import { UpdateStartupReconciler } from '@main/services/update/UpdateStartupReconciler';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('UpdateStartupReconciler', () => {
  it('limpa estado staged aplicado e remove diretorio de download da versao', () => {
    const userData = makeTempUserData();
    const store = new UpdateStateStore(userData);
    const stagedDir = path.join(userData, 'updates', 'downloads', '0.1.4');
    const stagedPath = path.join(stagedDir, 'dexter_0.1.4_amd64.deb');
    fs.mkdirSync(stagedDir, { recursive: true });
    fs.writeFileSync(stagedPath, 'stub', 'utf8');

    store.set(buildStagedState(stagedPath, '0.1.4'));
    const logger = mockLogger();
    const rmSpy = vi.fn(fs.rmSync);

    new UpdateStartupReconciler({
      userDataDir: userData,
      currentAppVersion: '0.1.4',
      stateStore: store,
      logger: logger as never,
      rmSync: rmSpy as never
    }).reconcile();

    const state = store.get();
    expect(state.phase).toBe('idle');
    expect(state.stagedVersion).toBeNull();
    expect(state.stagedArtifactPath).toBeNull();
    expect(fs.existsSync(stagedDir)).toBe(false);
    expect(rmSpy).toHaveBeenCalledWith(stagedDir, expect.objectContaining({ recursive: true, force: true }));
    expect(logger.info).toHaveBeenCalledWith(
      'update.startup.staged_reconciled',
      expect.objectContaining({
        outcome: 'applied'
      })
    );
  });

  it('mantem staged quando a versao atual ainda e menor que a staged', () => {
    const userData = makeTempUserData();
    const store = new UpdateStateStore(userData);
    const stagedDir = path.join(userData, 'updates', 'downloads', '0.1.5');
    const stagedPath = path.join(stagedDir, 'Dexter-0.1.5.AppImage');
    fs.mkdirSync(stagedDir, { recursive: true });
    fs.writeFileSync(stagedPath, 'stub', 'utf8');

    store.set(buildStagedState(stagedPath, '0.1.5'));
    const logger = mockLogger();
    const rmSpy = vi.fn(fs.rmSync);

    new UpdateStartupReconciler({
      userDataDir: userData,
      currentAppVersion: '0.1.4',
      stateStore: store,
      logger: logger as never,
      rmSync: rmSpy as never
    }).reconcile();

    const state = store.get();
    expect(state.phase).toBe('staged');
    expect(state.stagedVersion).toBe('0.1.5');
    expect(fs.existsSync(stagedDir)).toBe(true);
    expect(rmSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'update.startup.staged_pending',
      expect.objectContaining({
        currentVersion: '0.1.4',
        stagedVersion: '0.1.5'
      })
    );
  });

  it('nao remove caminho staged fora de updates/downloads, mas limpa o estado reconciliado', () => {
    const userData = makeTempUserData();
    const store = new UpdateStateStore(userData);
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-external-staged-'));
    tempDirs.push(externalDir);
    const stagedPath = path.join(externalDir, 'dexter_0.1.4_amd64.deb');
    fs.writeFileSync(stagedPath, 'stub', 'utf8');

    store.set(buildStagedState(stagedPath, '0.1.4'));
    const logger = mockLogger();
    const rmSpy = vi.fn(fs.rmSync);

    new UpdateStartupReconciler({
      userDataDir: userData,
      currentAppVersion: '0.1.4',
      stateStore: store,
      logger: logger as never,
      rmSync: rmSpy as never
    }).reconcile();

    expect(store.get().stagedVersion).toBeNull();
    expect(fs.existsSync(stagedPath)).toBe(true);
    expect(rmSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'update.startup.staged_reconciled',
      expect.objectContaining({
        cleanup: expect.objectContaining({
          attempted: false,
          reason: 'outside_downloads_root'
        })
      })
    );
  });
});

function makeTempUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-userdata-'));
  tempDirs.push(dir);
  return dir;
}

function buildStagedState(stagedArtifactPath: string, stagedVersion: string): UpdateState {
  return {
    phase: 'staged',
    provider: 'github',
    checkedAt: new Date().toISOString(),
    lastError: null,
    lastErrorCode: null,
    available: null,
    stagedVersion,
    stagedArtifactPath
  };
}

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

