import type { UpdateState } from '@shared/contracts';

export interface UpdateApplyLaunchResult {
  mode: 'relaunch' | 'linux-appimage' | 'linux-deb-assist' | 'linux-deb-pkexec';
  message: string;
}

export interface UpdateApplier {
  canHandle(state: UpdateState): boolean;
  requestRestartToApply(state: UpdateState): UpdateApplyLaunchResult;
}
