import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@shared/contracts';
import type { UpdateApplyLaunchResult } from '@main/services/update/UpdateApplier';
import { UpdateApplyAttemptStore } from '@main/services/update/UpdateApplyAttemptStore';
import { UpdatePostApplyCoordinator } from '@main/services/update/UpdatePostApplyCoordinator';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('UpdatePostApplyCoordinator', () => {
  it('registra tentativa e marca validacao como concluida quando app inicia na versao alvo', () => {
    const userData = makeUserData();
    seedDeb(userData, '0.1.4', 'dexter_0.1.4_amd64.deb');
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();

    const recordCoordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.4',
      logger: logger as never,
      attemptStore: store
    });
    recordCoordinator.recordApplyAttempt(
      buildStagedState('/tmp/updates/0.1.5/dexter_0.1.5_amd64.deb', '0.1.5'),
      { mode: 'linux-deb-pkexec', message: 'ok' }
    );

    const attempt = store.get();
    expect(attempt?.rollbackArtifactPath).toContain('0.1.4');

    const bootCoordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store
    });
    bootCoordinator.reconcileStartupSuccess();

    expect(store.get()).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.validation_passed',
      expect.objectContaining({
        currentVersion: '0.1.5',
        targetVersion: '0.1.5'
      })
    );
  });

  it('marca validacao como nao aplicada quando app reinicia na versao anterior', () => {
    const userData = makeUserData();
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-assist',
      packageType: 'deb',
      stagedArtifactPath: '/tmp/dexter_0.1.5_amd64.deb',
      rollbackArtifactPath: null,
      createdAt: new Date().toISOString()
    });

    new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.4',
      logger: logger as never,
      attemptStore: store
    }).reconcileStartupSuccess();

    expect(store.get()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'update.apply.validation_not_applied',
      expect.objectContaining({
        previousVersion: '0.1.4',
        targetVersion: '0.1.5'
      })
    );
  });

  it('agenda rollback automatico .deb em falha de boot quando opt-in esta habilitado', () => {
    const userData = makeUserData();
    const rollbackDeb = seedDeb(userData, '0.1.4', 'dexter_0.1.4_amd64.deb');
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-pkexec',
      packageType: 'deb',
      stagedArtifactPath: path.join(userData, 'updates', 'downloads', '0.1.5', 'dexter_0.1.5_amd64.deb'),
      rollbackArtifactPath: rollbackDeb,
      createdAt: new Date().toISOString()
    });

    const listeners: Partial<Record<'spawn' | 'error', (arg?: unknown) => void>> = {};
    const child = {
      unref: vi.fn(),
      once: vi.fn((event: 'spawn' | 'error', listener: (arg?: unknown) => void) => {
        listeners[event] = listener;
        return child;
      })
    };
    const spawnFn = vi.fn(() => child as never);

    const coordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store,
      autoDebRollbackOnBootFailure: true,
      spawnFn: spawnFn as never
    });

    coordinator.handleBootFailure('migration failure');
    listeners.spawn?.();

    expect(spawnFn).toHaveBeenCalledWith(
      'pkexec',
      ['apt', 'install', '-y', rollbackDeb],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore'
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'update.rollback.deb_scheduled',
      expect.objectContaining({
        rollbackToVersion: '0.1.4'
      })
    );
    expect(store.get()).toBeNull();
  });

  it('nao agenda rollback automatico sem opt-in explicito', () => {
    const userData = makeUserData();
    const rollbackDeb = seedDeb(userData, '0.1.4', 'dexter_0.1.4_amd64.deb');
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-pkexec',
      packageType: 'deb',
      stagedArtifactPath: '/tmp/dexter_0.1.5_amd64.deb',
      rollbackArtifactPath: rollbackDeb,
      createdAt: new Date().toISOString()
    });

    const spawnFn = vi.fn();
    new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store,
      autoDebRollbackOnBootFailure: false,
      spawnFn: spawnFn as never
    }).handleBootFailure('migration failure');

    expect(spawnFn).not.toHaveBeenCalled();
    expect(store.get()).not.toBeNull();
  });

  it('aguarda handshake de boot saudavel antes de concluir validacao quando habilitado', () => {
    const userData = makeUserData();
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    const timers: Array<() => void> = [];
    const clearTimeoutFn = vi.fn();

    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-pkexec',
      packageType: 'deb',
      stagedArtifactPath: '/tmp/dexter_0.1.5_amd64.deb',
      rollbackArtifactPath: null,
      createdAt: new Date().toISOString()
    });

    const coordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store,
      requireBootHealthyHandshake: true,
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return Symbol('timer');
      },
      clearTimeoutFn
    });

    coordinator.reconcileStartupSuccess();
    expect(store.get()).not.toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.validation_waiting_health',
      expect.objectContaining({
        targetVersion: '0.1.5'
      })
    );

    coordinator.markBootHealthy('renderer');
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(store.get()).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.validation_healthy',
      expect.objectContaining({
        source: 'renderer'
      })
    );

    expect(timers).toHaveLength(1);
  });

  it('dispara rollback por timeout de handshake quando grace period expira (opt-in)', () => {
    const userData = makeUserData();
    const rollbackDeb = seedDeb(userData, '0.1.4', 'dexter_0.1.4_amd64.deb');
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    const timers: Array<() => void> = [];
    const childListeners: Partial<Record<'spawn' | 'error', (arg?: unknown) => void>> = {};
    const child = {
      unref: vi.fn(),
      once: vi.fn((event: 'spawn' | 'error', listener: (arg?: unknown) => void) => {
        childListeners[event] = listener;
        return child;
      })
    };
    const spawnFn = vi.fn(() => child as never);

    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-pkexec',
      packageType: 'deb',
      stagedArtifactPath: '/tmp/dexter_0.1.5_amd64.deb',
      rollbackArtifactPath: rollbackDeb,
      createdAt: new Date().toISOString()
    });

    const coordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store,
      autoDebRollbackOnBootFailure: true,
      requireBootHealthyHandshake: true,
      bootHealthyGraceMs: 1500,
      spawnFn: spawnFn as never,
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return Symbol('timer');
      },
      clearTimeoutFn: vi.fn()
    });

    coordinator.reconcileStartupSuccess();
    expect(timers).toHaveLength(1);

    timers[0]!();
    childListeners.spawn?.();

    expect(logger.error).toHaveBeenCalledWith(
      'update.apply.validation_health_timeout',
      expect.objectContaining({
        graceMs: 1500
      })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'update.apply.validation_boot_failed',
      expect.objectContaining({
        targetVersion: '0.1.5'
      })
    );
    expect(spawnFn).toHaveBeenCalledWith(
      'pkexec',
      ['apt', 'install', '-y', rollbackDeb],
      expect.objectContaining({
        detached: true
      })
    );
    expect(store.get()).toBeNull();
  });

  it('mantem tentativa ate fim da janela de estabilidade apos handshake saudavel', () => {
    const userData = makeUserData();
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    const timers: Array<() => void> = [];
    const clearTimeoutFn = vi.fn();

    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-pkexec',
      packageType: 'deb',
      stagedArtifactPath: '/tmp/dexter_0.1.5_amd64.deb',
      rollbackArtifactPath: null,
      createdAt: new Date().toISOString()
    });

    const coordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store,
      requireBootHealthyHandshake: true,
      bootHealthyStabilityMs: 3000,
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return Symbol('timer');
      },
      clearTimeoutFn
    });

    coordinator.reconcileStartupSuccess();
    expect(timers).toHaveLength(1); // health grace

    coordinator.markBootHealthy('renderer');
    expect(store.get()).not.toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.validation_waiting_stability',
      expect.objectContaining({
        stabilityMs: 3000
      })
    );
    expect(timers).toHaveLength(2); // stability window

    timers[1]!();
    expect(store.get()).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.validation_stable',
      expect.objectContaining({
        stabilityMs: 3000
      })
    );
  });

  it('trata falha apos handshake durante janela de estabilidade como boot failure', () => {
    const userData = makeUserData();
    const rollbackDeb = seedDeb(userData, '0.1.4', 'dexter_0.1.4_amd64.deb');
    const store = new UpdateApplyAttemptStore(userData);
    const logger = mockLogger();
    const timers: Array<() => void> = [];
    const childListeners: Partial<Record<'spawn' | 'error', (arg?: unknown) => void>> = {};
    const child = {
      unref: vi.fn(),
      once: vi.fn((event: 'spawn' | 'error', listener: (arg?: unknown) => void) => {
        childListeners[event] = listener;
        return child;
      })
    };
    const spawnFn = vi.fn(() => child as never);

    store.set({
      targetVersion: '0.1.5',
      previousVersion: '0.1.4',
      mode: 'linux-deb-pkexec',
      packageType: 'deb',
      stagedArtifactPath: '/tmp/dexter_0.1.5_amd64.deb',
      rollbackArtifactPath: rollbackDeb,
      createdAt: new Date().toISOString()
    });

    const coordinator = new UpdatePostApplyCoordinator({
      userDataDir: userData,
      currentAppVersion: '0.1.5',
      logger: logger as never,
      attemptStore: store,
      autoDebRollbackOnBootFailure: true,
      requireBootHealthyHandshake: true,
      bootHealthyStabilityMs: 3000,
      spawnFn: spawnFn as never,
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return Symbol('timer');
      },
      clearTimeoutFn: vi.fn()
    });

    coordinator.reconcileStartupSuccess();
    coordinator.markBootHealthy('renderer');
    coordinator.handleBootFailure('renderer process gone: crashed');
    childListeners.spawn?.();

    expect(logger.error).toHaveBeenCalledWith(
      'update.apply.validation_boot_failed',
      expect.objectContaining({
        reason: 'renderer process gone: crashed'
      })
    );
    expect(spawnFn).toHaveBeenCalledWith(
      'pkexec',
      ['apt', 'install', '-y', rollbackDeb],
      expect.objectContaining({
        detached: true
      })
    );
    expect(store.get()).toBeNull();
  });
});

function makeUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-userdata-'));
  tempDirs.push(dir);
  return dir;
}

function seedDeb(userData: string, version: string, fileName: string): string {
  const dir = path.join(userData, 'updates', 'downloads', version);
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  fs.writeFileSync(fullPath, 'stub', 'utf8');
  return fullPath;
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
