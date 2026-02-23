import { Logger } from '@main/services/logging/Logger';
import type { UpdateState } from '@shared/contracts';
import type { UpdateApplier } from '@main/services/update/UpdateApplier';

interface ElectronRelaunchUpdateApplierOptions {
  logger: Logger;
  relaunch: () => void;
  schedule?: (fn: () => void, delayMs: number) => void;
  delayMs?: number;
}

export class ElectronRelaunchUpdateApplier implements UpdateApplier {
  private readonly logger: Logger;
  private readonly relaunch: () => void;
  private readonly schedule: (fn: () => void, delayMs: number) => void;
  private readonly delayMs: number;

  constructor(options: ElectronRelaunchUpdateApplierOptions) {
    this.logger = options.logger;
    this.relaunch = options.relaunch;
    this.schedule = options.schedule ?? ((fn, delayMs) => void setTimeout(fn, delayMs));
    this.delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.trunc(options.delayMs ?? 120)) : 120;
  }

  canHandle(_state: UpdateState): boolean {
    return true;
  }

  requestRestartToApply(state: UpdateState): void {
    this.logger.info('update.apply.restart_scheduled', {
      mode: 'relaunch',
      version: state.stagedVersion
    });

    this.schedule(() => {
      this.relaunch();
    }, this.delayMs);
  }
}

