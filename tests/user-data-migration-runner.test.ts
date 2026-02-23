import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';
import type { UserDataMigrationStep } from '@main/services/update/UserDataMigrations';
import { UserDataMigrationRunner } from '@main/services/update/UserDataMigrationRunner';
import { UserDataSchemaStateStore } from '@main/services/update/UserDataSchemaStateStore';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('UserDataMigrationRunner', () => {
  it('inicializa marker de schema em install novo', () => {
    const dir = mkTempDir();
    const logger = mockLogger();
    const runner = new UserDataMigrationRunner(
      dir,
      new UserDataSchemaStateStore(dir),
      new UpdateMigrationPlanner(),
      logger as never
    );

    const result = runner.ensureCurrent(1);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.adoptedCurrentVersion).toBe(false);
    expect(runner.getCurrentVersion()).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'update.migration.bootstrap',
      expect.objectContaining({ targetVersion: 1 })
    );
  });

  it('adota versao atual quando ha dados existentes e marker ausente', () => {
    const dir = mkTempDir();
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'dexter.config.json'), '{"model":"x"}', 'utf-8');

    const runner = new UserDataMigrationRunner(
      dir,
      new UserDataSchemaStateStore(dir),
      new UpdateMigrationPlanner(),
      mockLogger() as never
    );

    const result = runner.ensureCurrent(1);
    expect(result.ok).toBe(true);
    expect(result.adoptedCurrentVersion).toBe(true);
  });

  it('executa migracao 1 -> 2 com backup e atualiza schema marker', () => {
    const dir = mkTempDir();
    const permissionsDir = path.join(dir, 'permissions');
    fs.mkdirSync(permissionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(permissionsDir, 'policies.json'),
      JSON.stringify(
        {
          policies: {
            'tools.system.exec': {
              mode: 'allow'
            }
          }
        },
        null,
        2
      ),
      'utf-8'
    );

    const stateStore = new UserDataSchemaStateStore(dir);
    stateStore.setVersion(1);
    const runner = new UserDataMigrationRunner(dir, stateStore, new UpdateMigrationPlanner(), mockLogger() as never);

    const result = runner.ensureCurrent(2);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(runner.getCurrentVersion()).toBe(2);

    const migrated = JSON.parse(fs.readFileSync(path.join(permissionsDir, 'policies.json'), 'utf-8')) as {
      policies: Record<string, { mode: string; updatedAt: string }>;
    };
    expect(Object.keys(migrated.policies).sort()).toEqual([
      'runtime.install',
      'tools.filesystem.read',
      'tools.filesystem.write',
      'tools.system.exec'
    ]);
    expect(migrated.policies['tools.system.exec']?.mode).toBe('allow');
    expect(typeof migrated.policies['runtime.install']?.updatedAt).toBe('string');

    const backupRoot = path.join(dir, 'updates', 'migration-backups');
    expect(fs.existsSync(backupRoot)).toBe(true);
    const backups = fs.readdirSync(backupRoot);
    expect(backups.length).toBeGreaterThan(0);
  });

  it('faz rollback dos arquivos rastreados quando migration step falha', () => {
    const dir = mkTempDir();
    const configDir = path.join(dir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const configFile = path.join(configDir, 'dexter.config.json');
    fs.writeFileSync(configFile, '{"model":"original"}', 'utf-8');

    const steps: UserDataMigrationStep[] = [
      {
        id: 'failing-step',
        fromVersion: 1,
        toVersion: 2,
        run: (baseDir) => {
          fs.writeFileSync(path.join(baseDir, 'config', 'dexter.config.json'), '{"model":"mutated"}', 'utf-8');
          throw new Error('boom');
        }
      }
    ];
    const planner = new UpdateMigrationPlanner(steps);
    const stateStore = new UserDataSchemaStateStore(dir);
    stateStore.setVersion(1);
    const logger = mockLogger();
    const runner = new UserDataMigrationRunner(dir, stateStore, planner, logger as never, steps);

    const result = runner.ensureCurrent(2);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom');
    expect(runner.getCurrentVersion()).toBe(1);
    expect(fs.readFileSync(configFile, 'utf-8')).toBe('{"model":"original"}');
    expect(logger.error).toHaveBeenCalledWith(
      'update.migration.rollback',
      expect.objectContaining({
        fromVersion: 1,
        toVersion: 2
      })
    );
  });
});

function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-userdata-migrate-'));
  tempDirs.push(dir);
  return dir;
}

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}
