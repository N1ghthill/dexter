import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@shared/contracts';
import { LinuxDebUpdateApplier } from '@main/services/update/LinuxDebUpdateApplier';

describe('LinuxDebUpdateApplier', () => {
  it('identifica pacote .deb staged em Linux', () => {
    const applier = new LinuxDebUpdateApplier({
      logger: mockLogger(),
      platform: 'linux'
    });

    expect(applier.canHandle(buildState('/tmp/dexter_0.1.4_amd64.deb'))).toBe(true);
    expect(applier.canHandle(buildState('/tmp/dexter-0.1.4.AppImage'))).toBe(false);
  });

  it('agenda abertura assistida via xdg-open', () => {
    const scheduleCalls: Array<() => void> = [];
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }) as never);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const applier = new LinuxDebUpdateApplier({
      logger: logger as never,
      platform: 'linux',
      spawnFn: spawnFn as never,
      schedule: (fn) => {
        scheduleCalls.push(fn);
      }
    });

    const state = buildState('/tmp/dexter-updates/0.1.4/dexter_0.1.4_amd64.deb');
    const result = applier.requestRestartToApply(state);

    expect(result.mode).toBe('linux-deb-assist');
    expect(result.message).toContain('.deb');
    expect(result.message).toContain('agendada');
    expect(scheduleCalls).toHaveLength(1);
    expect(spawnFn).not.toHaveBeenCalled();

    scheduleCalls[0]!();

    expect(spawnFn).toHaveBeenCalledWith('xdg-open', [state.stagedArtifactPath], expect.objectContaining({
      detached: true,
      stdio: 'ignore'
    }));
    expect(unref).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.deb_opened',
      expect.objectContaining({
        version: '0.1.4'
      })
    );
  });

  it('agenda instalacao privilegiada via pkexec + apt quando configurado', () => {
    const scheduleCalls: Array<() => void> = [];
    const unref = vi.fn();
    const spawnFn = vi.fn(() => ({ unref }) as never);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const applier = new LinuxDebUpdateApplier({
      logger: logger as never,
      platform: 'linux',
      strategy: 'pkexec-apt',
      spawnFn: spawnFn as never,
      schedule: (fn) => {
        scheduleCalls.push(fn);
      }
    });

    const state = buildState('/tmp/dexter-updates/0.1.4/dexter_0.1.4_amd64.deb');
    const result = applier.requestRestartToApply(state);

    expect(result.mode).toBe('linux-deb-pkexec');
    expect(result.message).toContain('PolicyKit');
    expect(scheduleCalls).toHaveLength(1);
    expect(spawnFn).not.toHaveBeenCalled();

    scheduleCalls[0]!();

    expect(spawnFn).toHaveBeenCalledWith(
      'pkexec',
      ['apt', 'install', '-y', state.stagedArtifactPath],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore'
      })
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.deb_pkexec_spawned',
      expect.objectContaining({
        version: '0.1.4'
      })
    );
  });

  it('faz fallback para xdg-open quando pkexec falha de forma assincrona', () => {
    const scheduleCalls: Array<() => void> = [];
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const pkexecListeners: Partial<Record<'spawn' | 'error', (arg?: unknown) => void>> = {};
    const pkexecChild = {
      unref: vi.fn(),
      once: vi.fn((event: 'spawn' | 'error', listener: (arg?: unknown) => void) => {
        pkexecListeners[event] = listener;
        return pkexecChild;
      })
    };
    const openListeners: Partial<Record<'spawn' | 'error', (arg?: unknown) => void>> = {};
    const openChild = {
      unref: vi.fn(),
      once: vi.fn((event: 'spawn' | 'error', listener: (arg?: unknown) => void) => {
        openListeners[event] = listener;
        return openChild;
      })
    };

    const spawnFn = vi.fn((cmd: string) => (cmd === 'pkexec' ? (pkexecChild as never) : (openChild as never)));

    const applier = new LinuxDebUpdateApplier({
      logger: logger as never,
      platform: 'linux',
      strategy: 'pkexec-apt',
      spawnFn: spawnFn as never,
      schedule: (fn) => {
        scheduleCalls.push(fn);
      }
    });

    const state = buildState('/tmp/dexter-updates/0.1.4/dexter_0.1.4_amd64.deb');
    applier.requestRestartToApply(state);
    scheduleCalls[0]!();

    pkexecListeners.error?.(new Error('pkexec missing'));
    openListeners.spawn?.();

    expect(logger.warn).toHaveBeenCalledWith(
      'update.apply.deb_pkexec_fallback_open',
      expect.objectContaining({
        version: '0.1.4'
      })
    );
    expect(spawnFn).toHaveBeenNthCalledWith(
      2,
      'xdg-open',
      [state.stagedArtifactPath],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore'
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'update.apply.deb_opened',
      expect.objectContaining({
        fallbackFrom: 'pkexec-apt'
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
