import { BUILTIN_USER_DATA_MIGRATIONS, type UserDataMigrationStep } from '@main/services/update/UserDataMigrations';

export interface UserDataMigrationStepPlan {
  fromVersion: number;
  toVersion: number;
  id: string;
}

export interface UserDataMigrationPlan {
  fromVersion: number;
  toVersion: number;
  required: boolean;
  supported: boolean;
  blockedReason: string | null;
  steps: UserDataMigrationStepPlan[];
}

export class UpdateMigrationPlanner {
  constructor(private readonly migrations: ReadonlyArray<Pick<UserDataMigrationStep, 'id' | 'fromVersion' | 'toVersion'>> = BUILTIN_USER_DATA_MIGRATIONS) {}

  plan(fromVersion: number, toVersion: number): UserDataMigrationPlan {
    const from = sanitizeVersion(fromVersion);
    const to = sanitizeVersion(toVersion);

    if (to === from) {
      return {
        fromVersion: from,
        toVersion: to,
        required: false,
        supported: true,
        blockedReason: null,
        steps: []
      };
    }

    if (to < from) {
      return {
        fromVersion: from,
        toVersion: to,
        required: false,
        supported: false,
        blockedReason: 'Downgrade de schema de dados nao e suportado.',
        steps: []
      };
    }

    const steps: UserDataMigrationStepPlan[] = [];
    let cursor = from;
    while (cursor < to) {
      const next = this.migrations.find((item) => item.fromVersion === cursor);
      if (!next) {
        return {
          fromVersion: from,
          toVersion: to,
          required: true,
          supported: false,
          blockedReason: `Nao existe migracao registrada para schema ${cursor} -> ${cursor + 1}.`,
          steps
        };
      }

      steps.push({
        fromVersion: next.fromVersion,
        toVersion: next.toVersion,
        id: next.id
      });
      cursor = next.toVersion;
    }

    return {
      fromVersion: from,
      toVersion: to,
      required: true,
      supported: true,
      blockedReason: null,
      steps
    };
  }

  canApplyTargetVersion(fromVersion: number, toVersion: number): boolean {
    return this.plan(fromVersion, toVersion).supported;
  }
}

function sanitizeVersion(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
