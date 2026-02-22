import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionService } from '@main/services/permissions/PermissionService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('PermissionService', () => {
  it('inicia com politicas padrao em modo ask', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const service = new PermissionService(dir);
    const policies = service.list();

    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy.mode).toBe('ask');
    }
  });

  it('persiste alteracoes de politica entre instancias', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const serviceA = new PermissionService(dir);
    serviceA.set('runtime.install', 'allow');

    const serviceB = new PermissionService(dir);
    expect(serviceB.mode('runtime.install')).toBe('allow');
  });

  it('retorna prompt contextual quando modo ask', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const service = new PermissionService(dir);
    const check = service.check('runtime.install', 'Instalar runtime local');

    expect(check.allowed).toBe(false);
    expect(check.requiresPrompt).toBe(true);
  });

  it('retorna permissao direta quando modo allow', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const service = new PermissionService(dir);
    service.set('tools.filesystem.read', 'allow');

    const check = service.check('tools.filesystem.read', 'Ler arquivo de configuracao');
    expect(check.allowed).toBe(true);
    expect(check.requiresPrompt).toBe(false);
    expect(check.message).toContain('Permitido por politica');
  });

  it('retorna bloqueio contextual quando modo deny', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const service = new PermissionService(dir);
    service.set('tools.system.exec', 'deny');

    const check = service.check('tools.system.exec', 'Executar comando sensivel');
    expect(check.allowed).toBe(false);
    expect(check.requiresPrompt).toBe(false);
  });

  it('recria politicas padrao quando arquivo persistido tem modo invalido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const permissionsDir = path.join(dir, 'permissions');
    fs.mkdirSync(permissionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(permissionsDir, 'policies.json'),
      JSON.stringify({
        policies: {
          'runtime.install': { mode: 'allow', updatedAt: '2026-01-01T00:00:00.000Z' },
          'tools.filesystem.read': { mode: 'ask', updatedAt: '2026-01-01T00:00:00.000Z' },
          'tools.filesystem.write': { mode: 'invalid', updatedAt: '2026-01-01T00:00:00.000Z' },
          'tools.system.exec': { mode: 'deny', updatedAt: '2026-01-01T00:00:00.000Z' }
        }
      }),
      'utf-8'
    );

    const service = new PermissionService(dir);
    const policies = service.list();

    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy.mode).toBe('ask');
    }

    const persisted = JSON.parse(fs.readFileSync(path.join(permissionsDir, 'policies.json'), 'utf-8')) as {
      policies: Record<string, { mode: string }>;
    };
    expect(Object.values(persisted.policies).every((entry) => entry.mode === 'ask')).toBe(true);
  });
});
