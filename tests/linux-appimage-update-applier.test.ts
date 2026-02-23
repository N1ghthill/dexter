import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@shared/contracts';
import { LinuxAppImageUpdateApplier } from '@main/services/update/LinuxAppImageUpdateApplier';

describe('LinuxAppImageUpdateApplier', () => {
  it('identifica quando pode aplicar AppImage staged em Linux', () => {
    const applier = new LinuxAppImageUpdateApplier({
      logger: mockLogger(),
      exitCurrentApp: vi.fn(),
      platform: 'linux'
    });

    expect(applier.canHandle(buildState('/tmp/dexter-0.1.4.AppImage'))).toBe(true);
    expect(applier.canHandle(buildState('/tmp/dexter-0.1.4.deb'))).toBe(false);
  });

  it('falha em preflight se artefato staged nao existir', () => {
    const applier = new LinuxAppImageUpdateApplier({
      logger: mockLogger(),
      exitCurrentApp: vi.fn(),
      platform: 'linux',
      existsSync: () => false
    });

    expect(() => applier.requestRestartToApply(buildState('/tmp/dexter-0.1.4.AppImage'))).toThrow('nao encontrado');
  });

  it('agenda spawn do AppImage e encerra app atual apos sucesso', () => {
    const exitCurrentApp = vi.fn();
    const scheduleCalls: Array<() => void> = [];
    const chmodSync = vi.fn();
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }) as never);

    const applier = new LinuxAppImageUpdateApplier({
      logger: mockLogger(),
      exitCurrentApp,
      platform: 'linux',
      existsSync: () => true,
      chmodSync,
      spawnFn: spawnFn as never,
      schedule: (fn) => {
        scheduleCalls.push(fn);
      }
    });

    const state = buildState('/tmp/dexter-updates/0.1.4/dexter-0.1.4.AppImage');
    applier.requestRestartToApply(state);

    expect(chmodSync).toHaveBeenCalledWith(state.stagedArtifactPath, 0o755);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(scheduleCalls).toHaveLength(1);

    scheduleCalls[0]!();

    expect(spawnFn).toHaveBeenCalledWith(state.stagedArtifactPath, [], expect.objectContaining({
      detached: true,
      stdio: 'ignore'
    }));
    expect(unref).toHaveBeenCalledTimes(1);
    expect(exitCurrentApp).toHaveBeenCalledTimes(1);
  });

  it('nao encerra app atual quando spawn do AppImage falha de forma assincrona', () => {
    const exitCurrentApp = vi.fn();
    const scheduleCalls: Array<() => void> = [];
    const chmodSync = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const listeners: Partial<Record<'spawn' | 'error', (arg?: unknown) => void>> = {};
    const child = {
      unref: vi.fn(),
      once: vi.fn((event: 'spawn' | 'error', listener: (arg?: unknown) => void) => {
        listeners[event] = listener;
        return child;
      })
    };
    const spawnFn = vi.fn(() => child as never);

    const applier = new LinuxAppImageUpdateApplier({
      logger: logger as never,
      exitCurrentApp,
      platform: 'linux',
      existsSync: () => true,
      chmodSync,
      spawnFn: spawnFn as never,
      schedule: (fn) => {
        scheduleCalls.push(fn);
      }
    });

    const state = buildState('/tmp/dexter-updates/0.1.4/dexter-0.1.4.AppImage');
    applier.requestRestartToApply(state);
    scheduleCalls[0]!();

    listeners.error?.(new Error('ENOENT'));

    expect(exitCurrentApp).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'update.apply.appimage_spawn_error',
      expect.objectContaining({
        reason: 'ENOENT'
      })
    );
  });
});

function buildState(stagedArtifactPath: string | null): UpdateState {
  return {
    phase: 'staged',
    provider: 'github',
    checkedAt: new Date().toISOString(),
    lastError: null,
    lastErrorCode: null,
    available: null,
    stagedVersion: '0.1.4',
    stagedArtifactPath
  };
}

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as never;
}
