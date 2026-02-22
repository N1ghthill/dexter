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

  it('usa filtros padrao quando operacao/status nao sao informados', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const service = new ModelHistoryService(dir);
    service.block('pull', 'qwen2.5:7b', 'bloqueado');

    const page = service.query({
      page: 1,
      pageSize: 10
    } as never);

    expect(page.total).toBe(1);
    expect(page.items[0]?.operation).toBe('pull');
    expect(page.items[0]?.status).toBe('blocked');
  });

  it('retorna duracao nula quando startedAt interno esta invalido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const service = new ModelHistoryService(dir);
    const record = service.start('pull', 'llama3.2:3b', 'iniciando');

    const internalRecord = (service as never as { records: Array<{ id: string; startedAt: string }> }).records.find(
      (item) => item.id === record.id
    );
    if (!internalRecord) {
      throw new Error('Esperava registro interno');
    }
    internalRecord.startedAt = 'invalido';

    const finished = service.finish(record.id, 'error', 'falhou', null);
    expect(finished?.durationMs).toBeNull();
  });

  it('ignora registros persistidos com datas invalidas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const historyDir = path.join(dir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(
      path.join(historyDir, 'model-operations.json'),
      JSON.stringify(
        {
          records: [
            {
              id: 'bad-1',
              operation: 'pull',
              model: 'llama3.2:3b',
              status: 'done',
              message: 'invalido',
              startedAt: 'nao-e-data',
              finishedAt: null,
              durationMs: null,
              percent: 10
            },
            {
              id: 'ok-1',
              operation: 'remove',
              model: 'qwen2.5:7b',
              status: 'blocked',
              message: 'ok',
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              durationMs: 0,
              percent: null
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );

    const service = new ModelHistoryService(dir);
    const page = service.query({
      page: 1,
      pageSize: 10,
      operation: 'all',
      status: 'all'
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe('ok-1');
  });

  it('limita historico em 500 registros e retorna copias defensivas na query', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const service = new ModelHistoryService(dir);
    for (let i = 0; i < 520; i += 1) {
      service.block('pull', `model-${i}`, `msg-${i}`);
    }

    const page = service.query({
      page: Number.NaN,
      pageSize: Number.POSITIVE_INFINITY,
      operation: 'all',
      status: 'all'
    });
    expect(page.total).toBe(500);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(1);

    const first = page.items[0];
    if (!first) {
      throw new Error('Esperava um item');
    }
    const originalId = first.id;
    first.id = 'mutado-externo';

    const again = service.query({
      page: 1,
      pageSize: 1,
      operation: 'all',
      status: 'all'
    });
    expect(again.items[0]?.id).toBe(originalId);
  });

  it('auto-corrige payload persistido invalido e remove registros malformados', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const historyDir = path.join(dir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    const filePath = path.join(historyDir, 'model-operations.json');
    const now = new Date().toISOString();

    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          records: [
            null,
            {
              id: 123,
              operation: 'pull',
              model: 'm1',
              status: 'running',
              message: 'x',
              startedAt: now,
              finishedAt: null,
              durationMs: null,
              percent: null
            },
            {
              id: 'bad-operation',
              operation: 'train',
              model: 'm1',
              status: 'running',
              message: 'x',
              startedAt: now,
              finishedAt: null,
              durationMs: null,
              percent: null
            },
            {
              id: 'bad-status',
              operation: 'pull',
              model: 'm1',
              status: 'queued',
              message: 'x',
              startedAt: now,
              finishedAt: null,
              durationMs: null,
              percent: null
            },
            {
              id: 'bad-started-at-type',
              operation: 'pull',
              model: 'm1',
              status: 'running',
              message: 'x',
              startedAt: 123,
              finishedAt: null,
              durationMs: null,
              percent: null
            },
            {
              id: 'bad-percent',
              operation: 'pull',
              model: 'm1',
              status: 'running',
              message: 'x',
              startedAt: now,
              finishedAt: null,
              durationMs: null,
              percent: 200
            },
            {
              id: 'ok',
              operation: 'remove',
              model: 'm2',
              status: 'blocked',
              message: 'ok',
              startedAt: now,
              finishedAt: now,
              durationMs: 0,
              percent: null
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );

    const service = new ModelHistoryService(dir);
    const page = service.query({
      page: 1,
      pageSize: 20,
      operation: 'all',
      status: 'all'
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe('ok');

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      records: Array<{ id: string }>;
    };
    expect(persisted.records).toHaveLength(1);
    expect(persisted.records[0]?.id).toBe('ok');
  });

  it('recupera arquivo quebrado e normaliza payload sem array', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-history-'));
    tempDirs.push(dir);

    const historyDir = path.join(dir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    const filePath = path.join(historyDir, 'model-operations.json');

    fs.writeFileSync(filePath, '{json quebrado', 'utf-8');
    const broken = new ModelHistoryService(dir);
    const firstPage = broken.query({
      page: 1,
      pageSize: 10,
      operation: 'all',
      status: 'all'
    });
    expect(firstPage.total).toBe(0);

    fs.writeFileSync(filePath, JSON.stringify({ records: {} }, null, 2), 'utf-8');
    const nonArray = new ModelHistoryService(dir);
    const secondPage = nonArray.query({
      page: 1,
      pageSize: 10,
      operation: 'all',
      status: 'all'
    });
    expect(secondPage.total).toBe(0);

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      records: unknown[];
    };
    expect(Array.isArray(persisted.records)).toBe(true);
  });
});
