import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ModelHistoryService', () => {
  it('persiste historico entre instancias', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const serviceA = new ModelHistoryService(dir);
    const record = serviceA.start('pull', 'llama3.2:3b', 'Iniciando download.');
    serviceA.progress(record.id, 'Metade concluida.', 50);
    serviceA.finish(record.id, 'done', 'Concluido.', 100);

    const serviceB = new ModelHistoryService(dir);
    const page = serviceB.query({
      page: 1,
      pageSize: 10,
      operation: 'all',
      status: 'all'
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.operation).toBe('pull');
    expect(page.items[0]?.status).toBe('done');
    expect(page.items[0]?.percent).toBe(100);
    expect(page.items[0]?.durationMs).not.toBeNull();
  });

  it('filtra por operacao e status com paginacao segura', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const service = new ModelHistoryService(dir);
    service.block('pull', 'qwen2.5:7b', 'Bloqueado por politica.');
    service.block('pull', 'llama3.2:3b', 'Bloqueado por politica.');
    service.block('remove', 'qwen2.5:7b', 'Bloqueado por politica.');
    const removeRecord = service.start('remove', 'llama3.2:3b', 'Iniciando remocao.');
    service.finish(removeRecord.id, 'error', 'Falha ao remover.', null);

    const allPage = service.query({
      page: 1,
      pageSize: 2,
      operation: 'all',
      status: 'all'
    });
    expect(allPage.total).toBe(4);
    expect(allPage.totalPages).toBe(2);
    expect(allPage.items).toHaveLength(2);

    const pullOnly = service.query({
      page: 1,
      pageSize: 10,
      operation: 'pull',
      status: 'all'
    });
    expect(pullOnly.total).toBe(2);
    expect(pullOnly.items.every((item) => item.operation === 'pull')).toBe(true);

    const blockedOnly = service.query({
      page: 1,
      pageSize: 10,
      operation: 'all',
      status: 'blocked'
    });
    expect(blockedOnly.total).toBe(3);
    expect(blockedOnly.items.every((item) => item.status === 'blocked')).toBe(true);

    const removeError = service.query({
      page: 1,
      pageSize: 10,
      operation: 'remove',
      status: 'error'
    });
    expect(removeError.total).toBe(1);
    expect(removeError.items[0]?.model).toBe('llama3.2:3b');

    const overflowPage = service.query({
      page: 99,
      pageSize: 3,
      operation: 'all',
      status: 'all'
    });
    expect(overflowPage.page).toBe(2);
    expect(overflowPage.items).toHaveLength(1);
  });

  it('retorna null para ids desconhecidos em progresso/finalizacao', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const service = new ModelHistoryService(dir);
    expect(service.progress('nao-existe', 'msg', 10)).toBeNull();
    expect(service.finish('nao-existe', 'error', 'msg', 10)).toBeNull();
  });
});
