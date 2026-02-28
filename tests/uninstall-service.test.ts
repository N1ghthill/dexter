import { describe, expect, it, vi } from 'vitest';
import { UninstallService } from '@main/services/uninstall/UninstallService';
import { UNINSTALL_CONFIRMATION_TOKEN } from '@shared/contracts';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe('UninstallService', () => {
  it('bloqueia uninstall quando token de confirmacao e invalido', async () => {
    const logger = createLogger();
    const runCommand = vi.fn();
    const service = new UninstallService(logger as never, 'linux', {
      runCommand
    });

    const result = await service.uninstall({
      packageMode: 'remove',
      removeUserData: false,
      removeRuntimeSystem: false,
      removeRuntimeUserData: false,
      confirmationToken: 'TOKEN-INVALIDO'
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_confirmation');
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('usa helper privilegiado via pkexec quando disponivel', async () => {
    const logger = createLogger();
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, output: 'pkg ok', errorOutput: '', timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, output: 'ollama ok', errorOutput: '', timedOut: false });

    const service = new UninstallService(logger as never, 'linux', {
      linuxPrivilegedHelperPath: '/opt/dexter/runtime-helper.sh',
      pathExists: (targetPath) => targetPath === '/opt/dexter/runtime-helper.sh',
      probeCommand: (command) => command === 'pkexec' || command === 'apt-get',
      hasDesktopPrivilegePrompt: () => true,
      runCommand,
      userHomeDir: '/home/dev'
    });

    const result = await service.uninstall({
      packageMode: 'purge',
      removeUserData: false,
      removeRuntimeSystem: true,
      removeRuntimeUserData: false,
      confirmationToken: UNINSTALL_CONFIRMATION_TOKEN
    });

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('linux-pkexec-helper');
    expect(runCommand).toHaveBeenNthCalledWith(
      1,
      'pkexec',
      ['bash', '/opt/dexter/runtime-helper.sh', 'uninstall-dexter-purge'],
      10 * 60 * 1000
    );
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      'pkexec',
      ['bash', '/opt/dexter/runtime-helper.sh', 'uninstall-ollama-system'],
      10 * 60 * 1000
    );
  });

  it('retorna erro de TTY quando sudo -n exige terminal interativo', async () => {
    const logger = createLogger();
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 1,
      output: '',
      errorOutput: 'sudo: a terminal is required to read the password',
      timedOut: false
    });

    const service = new UninstallService(logger as never, 'linux', {
      probeCommand: (command) => command === 'sudo' || command === 'apt-get',
      hasDesktopPrivilegePrompt: () => false,
      runCommand,
      userHomeDir: '/home/dev'
    });

    const result = await service.uninstall({
      packageMode: 'remove',
      removeUserData: false,
      removeRuntimeSystem: false,
      removeRuntimeUserData: false,
      confirmationToken: UNINSTALL_CONFIRMATION_TOKEN
    });

    expect(result.ok).toBe(false);
    expect(result.strategy).toBe('linux-sudo-noninteractive');
    expect(result.errorCode).toBe('sudo_tty_required');
    expect(result.manualRequired).toBe(true);
  });

  it('mantem uninstall principal ok e reporta avisos de limpeza opcional', async () => {
    const logger = createLogger();
    const removedPaths: string[] = [];
    const runCommand = vi.fn().mockResolvedValue({
      exitCode: 0,
      output: 'ok',
      errorOutput: '',
      timedOut: false
    });

    const service = new UninstallService(logger as never, 'linux', {
      runCommand,
      probeCommand: (command) => command === 'sudo' || command === 'apt-get',
      hasDesktopPrivilegePrompt: () => false,
      userHomeDir: '/home/dev',
      userDataPaths: ['/home/dev/.config/dexter', '/tmp/fora-do-home'],
      pathExists: (targetPath) =>
        targetPath === '/home/dev/.config/dexter' || targetPath === '/home/dev/.ollama' || targetPath === '/tmp/fora-do-home',
      removePathRecursively: (targetPath) => {
        if (targetPath === '/home/dev/.ollama') {
          throw new Error('permissao negada');
        }
        removedPaths.push(targetPath);
      }
    });

    const result = await service.uninstall({
      packageMode: 'remove',
      removeUserData: true,
      removeRuntimeSystem: false,
      removeRuntimeUserData: true,
      confirmationToken: UNINSTALL_CONFIRMATION_TOKEN
    });

    expect(result.ok).toBe(true);
    expect(removedPaths).toContain('/home/dev/.config/dexter');
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.nextSteps?.join(' ')).toContain('avisos');
  });
});
