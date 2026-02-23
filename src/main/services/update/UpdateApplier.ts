import type { UpdateState } from '@shared/contracts';

export interface UpdateApplier {
  canHandle(state: UpdateState): boolean;
  requestRestartToApply(state: UpdateState): void;
}

