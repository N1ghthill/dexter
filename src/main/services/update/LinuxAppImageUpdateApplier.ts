import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Logger } from '@main/services/logging/Logger';
import type { UpdateState } from '@shared/contracts';
import type { UpdateApplier, UpdateApplyLaunchResult } from '@main/services/update/UpdateApplier';

interface LinuxAppImageUpdateApplierOptions {
  logger: Logger;
  exitCurrentApp: () => void;
  schedule?: (fn: () => void, delayMs: number) => void;
  delayMs?: number;
  platform?: NodeJS.Platform;
  existsSync?: (filePath: string) => boolean;
  chmodSync?: (filePath: string, mode: number) => void;
  spawnFn?: typeof spawn;
}

export class LinuxAppImageUpdateApplier implements UpdateApplier {
  private readonly logger: Logger;
  private readonly exitCurrentApp: () => void;
  private readonly schedule: (fn: () => void, delayMs: number) => void;
  private readonly delayMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly existsSync: (filePath: string) => boolean;
  private readonly chmodSync: (filePath: string, mode: number) => void;
  private readonly spawnFn: typeof spawn;

  constructor(options: LinuxAppImageUpdateApplierOptions) {
    this.logger = options.logger;
    this.exitCurrentApp = options.exitCurrentApp;
    this.schedule = options.schedule ?? ((fn, delayMs) => void setTimeout(fn, delayMs));
    this.delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.trunc(options.delayMs ?? 120)) : 120;
    this.platform = options.platform ?? process.platform;
    this.existsSync = options.existsSync ?? fs.existsSync;
    this.chmodSync = options.chmodSync ?? fs.chmodSync;
    this.spawnFn = options.spawnFn ?? spawn;
  }

  canHandle(state: UpdateState): boolean {
    return this.platform === 'linux' && isAppImagePath(state.stagedArtifactPath);
  }

  requestRestartToApply(state: UpdateState): UpdateApplyLaunchResult {
    const artifactPath = normalizeStagedArtifactPath(state);
    if (this.platform !== 'linux') {
      throw new Error('Applier AppImage disponivel apenas em Linux.');
    }
    if (!isAppImagePath(artifactPath)) {
      throw new Error('Artefato staged nao e um AppImage suportado para aplicacao automatizada.');
    }
    if (!this.existsSync(artifactPath)) {
      throw new Error(`Artefato staged nao encontrado: ${artifactPath}`);
    }

    this.chmodSync(artifactPath, 0o755);
    this.logger.info('update.apply.restart_scheduled', {
      mode: 'linux-appimage',
      version: state.stagedVersion,
      artifactPath
    });

    this.schedule(() => {
      try {
        const child = this.spawnFn(artifactPath, [], {
          cwd: path.dirname(artifactPath),
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env
          }
        });
        child.unref();
        observeChildSpawn(
          child,
          () => {
            this.logger.info('update.apply.appimage_spawned', {
              version: state.stagedVersion,
              artifactPath
            });
            this.exitCurrentApp();
          },
          (error) => {
            this.logger.error('update.apply.appimage_spawn_error', {
              version: state.stagedVersion,
              artifactPath,
              reason: error instanceof Error ? error.message : String(error)
            });
          }
        );
      } catch (error) {
        this.logger.error('update.apply.appimage_spawn_error', {
          version: state.stagedVersion,
          artifactPath,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }, this.delayMs);

    return {
      mode: 'linux-appimage',
      message: `Aplicacao do update ${state.stagedVersion ?? ''} agendada via AppImage staged.`.trim()
    };
  }
}

function normalizeStagedArtifactPath(state: UpdateState): string {
  return typeof state.stagedArtifactPath === 'string' ? state.stagedArtifactPath.trim() : '';
}

function isAppImagePath(filePath: string | null | undefined): filePath is string {
  return typeof filePath === 'string' && filePath.trim().toLowerCase().endsWith('.appimage');
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
