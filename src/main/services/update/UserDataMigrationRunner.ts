import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@main/services/logging/Logger';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';
import { BUILTIN_USER_DATA_MIGRATIONS, type UserDataMigrationStep } from '@main/services/update/UserDataMigrations';
import { UserDataSchemaStateStore } from '@main/services/update/UserDataSchemaStateStore';

export interface UserDataMigrationRunResult {
  ok: boolean;
  fromVersion: number;
  toVersion: number;
  applied: boolean;
  adoptedCurrentVersion: boolean;
  message: string;
}

export class UserDataMigrationRunner {
  private readonly stepsById: Map<string, UserDataMigrationStep>;

  constructor(
    private readonly baseDir: string,
    private readonly schemaStateStore: UserDataSchemaStateStore,
    private readonly planner: UpdateMigrationPlanner,
    private readonly logger: Logger,
    steps: ReadonlyArray<UserDataMigrationStep> = BUILTIN_USER_DATA_MIGRATIONS
  ) {
    this.stepsById = new Map(steps.map((step) => [step.id, step]));
  }

  ensureCurrent(targetVersion: number): UserDataMigrationRunResult {
    const target = sanitizeVersion(targetVersion);
    const state = this.schemaStateStore.get();

    if (!state) {
      this.schemaStateStore.setVersion(target);
      const adopted = this.detectExistingUserData();
      const result: UserDataMigrationRunResult = {
        ok: true,
        fromVersion: target,
        toVersion: target,
        applied: false,
        adoptedCurrentVersion: adopted,
        message: adopted
          ? `Schema version ${target} adotada para dados existentes (bootstrap de migracao).`
          : `Schema version ${target} inicializada.`
      };
      this.logger.info('update.migration.bootstrap', {
        targetVersion: target,
        adoptedExistingData: adopted
      });
      return result;
    }

    const plan = this.planner.plan(state.version, target);
    if (!plan.supported) {
      this.logger.error('update.migration.unsupported', {
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        reason: plan.blockedReason
      });
      return {
        ok: false,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        applied: false,
        adoptedCurrentVersion: false,
        message: plan.blockedReason || 'Migracao de schema nao suportada.'
      };
    }

    if (!plan.required) {
      return {
        ok: true,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        applied: false,
        adoptedCurrentVersion: false,
        message: 'Schema de dados ja esta na versao atual.'
      };
    }

    this.logger.info('update.migration.start', {
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      steps: plan.steps.map((step) => step.id)
    });

    const backup = this.createBackupSnapshot(plan);

    try {
      for (const step of plan.steps) {
        const impl = this.stepsById.get(step.id);
        if (!impl) {
          throw new Error(`Implementacao ausente para migration step ${step.id}.`);
        }

        this.logger.info('update.migration.step.start', {
          id: step.id,
          fromVersion: step.fromVersion,
          toVersion: step.toVersion
        });

        impl.run(this.baseDir);

        this.logger.info('update.migration.step.finish', {
          id: step.id,
          fromVersion: step.fromVersion,
          toVersion: step.toVersion
        });
      }

      this.schemaStateStore.setVersion(plan.toVersion);
      this.logger.info('update.migration.finish', {
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        backupDir: backup.backupDir
      });
      return {
        ok: true,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        applied: true,
        adoptedCurrentVersion: false,
        message: `Migracao de schema concluida: ${plan.fromVersion} -> ${plan.toVersion}.`
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.restoreBackupSnapshot(backup);
      this.logger.error('update.migration.rollback', {
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        backupDir: backup.backupDir,
        reason
      });
      return {
        ok: false,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        applied: false,
        adoptedCurrentVersion: false,
        message: `Falha na migracao de schema (${plan.fromVersion} -> ${plan.toVersion}): ${reason}`
      };
    }
  }

  getCurrentVersion(): number {
    return this.schemaStateStore.get()?.version ?? 0;
  }

  private detectExistingUserData(): boolean {
    return trackedUserDataFiles(this.baseDir).some((filePath) => fs.existsSync(filePath));
  }

  private createBackupSnapshot(plan: { fromVersion: number; toVersion: number }) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(
      this.baseDir,
      'updates',
      'migration-backups',
      `${stamp}-${plan.fromVersion}-to-${plan.toVersion}`
    );
    const tracked = trackedUserDataFiles(this.baseDir);
    const files = tracked.map((filePath) => ({
      filePath,
      relativePath: path.relative(this.baseDir, filePath),
      existed: fs.existsSync(filePath)
    }));

    fs.mkdirSync(backupDir, { recursive: true });

    for (const file of files) {
      if (!file.existed) {
        continue;
      }

      const target = path.join(backupDir, file.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.filePath, target);
    }

    this.logger.info('update.migration.backup_created', {
      backupDir,
      fileCount: files.filter((item) => item.existed).length
    });

    return {
      backupDir,
      files
    };
  }

  private restoreBackupSnapshot(backup: {
    backupDir: string;
    files: Array<{ filePath: string; relativePath: string; existed: boolean }>;
  }): void {
    for (const file of backup.files) {
      const source = path.join(backup.backupDir, file.relativePath);
      if (file.existed) {
        if (fs.existsSync(source)) {
          fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
          fs.copyFileSync(source, file.filePath);
        }
        continue;
      }

      if (fs.existsSync(file.filePath)) {
        fs.rmSync(file.filePath, { force: true });
      }
    }
  }
}

export function trackedUserDataFiles(baseDir: string): string[] {
  return [
    path.join(baseDir, 'config', 'dexter.config.json'),
    path.join(baseDir, 'memory', 'medium-memory.json'),
    path.join(baseDir, 'memory', 'long-memory.json'),
    path.join(baseDir, 'history', 'model-operations.json'),
    path.join(baseDir, 'permissions', 'policies.json')
  ];
}

function sanitizeVersion(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
