import type { UpdateState } from '@shared/contracts';
import type { UpdateApplier } from '@main/services/update/UpdateApplier';

export class CompositeUpdateApplier implements UpdateApplier {
  constructor(private readonly appliers: UpdateApplier[]) {}

  canHandle(state: UpdateState): boolean {
    return this.appliers.some((applier) => applier.canHandle(state));
  }

  requestRestartToApply(state: UpdateState): void {
    const applier = this.appliers.find((candidate) => candidate.canHandle(state));
    if (!applier) {
      throw new Error('Nenhum applier de update compativel para o estado staged atual.');
    }

    applier.requestRestartToApply(state);
  }
}

