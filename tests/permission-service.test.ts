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

  it('retorna bloqueio contextual quando modo deny', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-perm-'));
    tempDirs.push(dir);

    const service = new PermissionService(dir);
    service.set('tools.system.exec', 'deny');

    const check = service.check('tools.system.exec', 'Executar comando sensivel');
    expect(check.allowed).toBe(false);
    expect(check.requiresPrompt).toBe(false);
  });
});
