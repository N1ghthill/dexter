import path from 'node:path';
import { spawn } from 'node:child_process';
import { Logger } from '@main/services/logging/Logger';
import type { UpdateApplier, UpdateApplyLaunchResult } from '@main/services/update/UpdateApplier';
import type { UpdateState } from '@shared/contracts';

interface LinuxDebUpdateApplierOptions {
  logger: Logger;
  schedule?: (fn: () => void, delayMs: number) => void;
  delayMs?: number;
  platform?: NodeJS.Platform;
  spawnFn?: typeof spawn;
  strategy?: 'assist' | 'pkexec-apt';
  pkexecCommand?: string;
  aptCommand?: string;
}

export class LinuxDebUpdateApplier implements UpdateApplier {
  private readonly logger: Logger;
  private readonly schedule: (fn: () => void, delayMs: number) => void;
  private readonly delayMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly spawnFn: typeof spawn;
  private readonly strategy: 'assist' | 'pkexec-apt';
  private readonly pkexecCommand: string;
  private readonly aptCommand: string;

  constructor(options: LinuxDebUpdateApplierOptions) {
    this.logger = options.logger;
    this.schedule = options.schedule ?? ((fn, delayMs) => void setTimeout(fn, delayMs));
    this.delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.trunc(options.delayMs ?? 120)) : 120;
    this.platform = options.platform ?? process.platform;
    this.spawnFn = options.spawnFn ?? spawn;
    this.strategy = options.strategy === 'pkexec-apt' ? 'pkexec-apt' : 'assist';
    this.pkexecCommand = normalizeCommandName(options.pkexecCommand, 'pkexec');
    this.aptCommand = normalizeCommandName(options.aptCommand, 'apt');
  }

  canHandle(state: UpdateState): boolean {
    return this.platform === 'linux' && isDebPath(state.stagedArtifactPath);
  }

  requestRestartToApply(state: UpdateState): UpdateApplyLaunchResult {
    const artifactPath = normalizeStagedArtifactPath(state);
    if (this.platform !== 'linux') {
      throw new Error('Applier .deb disponivel apenas em Linux.');
    }
    if (!isDebPath(artifactPath)) {
      throw new Error('Artefato staged nao e um pacote .deb suportado para aplicacao assistida.');
    }

    if (this.strategy === 'pkexec-apt') {
      return this.schedulePrivilegedDebInstall(state, artifactPath);
    }

    return this.scheduleDesktopDebOpen(state, artifactPath);
  }

  private scheduleDesktopDebOpen(state: UpdateState, artifactPath: string): UpdateApplyLaunchResult {
    this.logger.info('update.apply.restart_scheduled', {
      mode: 'linux-deb-assist',
      version: state.stagedVersion,
      artifactPath
    });

    this.schedule(() => {
      this.openDebViaDesktop(state, artifactPath);
    }, this.delayMs);

    return {
      mode: 'linux-deb-assist',
      message: `Abertura do instalador .deb para o update ${state.stagedVersion ?? ''} foi agendada. Conclua a instalacao e reinicie o app.`.trim()
    };
  }

  private schedulePrivilegedDebInstall(state: UpdateState, artifactPath: string): UpdateApplyLaunchResult {
    const commandArgs = [this.aptCommand, 'install', '-y', artifactPath];
    this.logger.info('update.apply.restart_scheduled', {
      mode: 'linux-deb-pkexec',
      version: state.stagedVersion,
      artifactPath,
      command: this.pkexecCommand,
      args: commandArgs
    });

    this.schedule(() => {
      try {
        const child = this.spawnFn(this.pkexecCommand, commandArgs, {
          cwd: path.dirname(artifactPath),
          detached: true,
          stdio: 'ignore',
          env: { ...process.env }
        });
        child.unref();
        observeChildSpawn(
          child,
          () => {
            this.logger.info('update.apply.deb_pkexec_spawned', {
              version: state.stagedVersion,
              artifactPath,
              command: this.pkexecCommand,
              args: commandArgs
            });
          },
          (error) => {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error('update.apply.deb_pkexec_error', {
              version: state.stagedVersion,
              artifactPath,
              reason
            });
            this.logger.warn('update.apply.deb_pkexec_fallback_open', {
              version: state.stagedVersion,
              artifactPath
            });
            this.openDebViaDesktop(state, artifactPath, 'pkexec-apt');
          }
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error('update.apply.deb_pkexec_error', {
          version: state.stagedVersion,
          artifactPath,
          reason
        });
        this.logger.warn('update.apply.deb_pkexec_fallback_open', {
          version: state.stagedVersion,
          artifactPath
        });
        this.openDebViaDesktop(state, artifactPath, 'pkexec-apt');
      }
    }, this.delayMs);

    return {
      mode: 'linux-deb-pkexec',
      message:
        `Instalacao privilegiada (.deb) do update ${state.stagedVersion ?? ''} foi agendada via PolicyKit (pkexec + apt). Se a autenticacao falhar, o Dexter tentara abrir o instalador padrao.`.trim()
    };
  }

  private openDebViaDesktop(state: UpdateState, artifactPath: string, fallbackFrom?: 'pkexec-apt'): void {
    try {
      const child = this.spawnFn('xdg-open', [artifactPath], {
        cwd: path.dirname(artifactPath),
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
      });
      child.unref();
      observeChildSpawn(
        child,
        () => {
          this.logger.info('update.apply.deb_opened', {
            version: state.stagedVersion,
            artifactPath,
            ...(fallbackFrom ? { fallbackFrom } : {})
          });
        },
        (error) => {
          this.logger.error('update.apply.deb_open_error', {
            version: state.stagedVersion,
            artifactPath,
            reason: error instanceof Error ? error.message : String(error),
            ...(fallbackFrom ? { fallbackFrom } : {})
          });
        }
      );
    } catch (error) {
      this.logger.error('update.apply.deb_open_error', {
        version: state.stagedVersion,
        artifactPath,
        reason: error instanceof Error ? error.message : String(error),
        ...(fallbackFrom ? { fallbackFrom } : {})
      });
    }
  }
}

function normalizeStagedArtifactPath(state: UpdateState): string {
  return typeof state.stagedArtifactPath === 'string' ? state.stagedArtifactPath.trim() : '';
}

function isDebPath(filePath: string | null | undefined): filePath is string {
  return typeof filePath === 'string' && filePath.trim().toLowerCase().endsWith('.deb');
}

function normalizeCommandName(value: string | undefined, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : fallback;
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
