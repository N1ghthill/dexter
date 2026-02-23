import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditExportService } from '@main/services/audit/AuditExportService';
import { Logger } from '@main/services/logging/Logger';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('AuditExportService', () => {
  it('exporta historico filtrado em json e csv', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-audit-'));
    tempDirs.push(dir);

    const logger = new Logger(dir);
    const history = new ModelHistoryService(dir);
    const service = new AuditExportService(history, logger);

    const record = history.start('pull', 'llama3.2:3b', 'Iniciando pull.');
    history.finish(record.id, 'done', 'Concluido.', 100);
    history.block('remove', 'qwen2.5:7b', 'Bloqueado por politica.');

    const json = service.exportModelHistory('json', {
      operation: 'pull',
      status: 'done'
    });
    const parsed = JSON.parse(json.content) as Array<{ operation: string; status: string }>;
    expect(json.fileName.endsWith('.json')).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.operation).toBe('pull');
    expect(parsed[0]?.status).toBe('done');

    const csv = service.exportModelHistory('csv', { operation: 'all', status: 'all' });
    expect(csv.fileName.endsWith('.csv')).toBe(true);
    expect(csv.content).toContain('id,operation,model,status,message');
    expect(csv.content).toContain('llama3.2:3b');

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const emptyByDate = service.exportModelHistory('json', {
      operation: 'all',
      status: 'all',
      dateFrom: tomorrow
    });
    expect(JSON.parse(emptyByDate.content)).toHaveLength(0);
  });

  it('exporta logs em json e csv', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-audit-'));
    tempDirs.push(dir);

    const logger = new Logger(dir);
    const history = new ModelHistoryService(dir);
    const service = new AuditExportService(history, logger);

    logger.info('audit.test', { scope: 'logs' });
    logger.warn('audit.warn', { code: 1 });

    const json = service.exportLogs('json');
    const parsed = JSON.parse(json.content) as Array<{ message: string }>;
    expect(json.fileName.endsWith('.json')).toBe(true);
    expect(typeof json.sha256).toBe('string');
    expect(typeof json.contentBytes).toBe('number');
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed.some((entry) => entry.message === 'audit.test')).toBe(true);

    const csv = service.exportLogs('csv');
    expect(csv.fileName.endsWith('.csv')).toBe(true);
    expect(typeof csv.sha256).toBe('string');
    expect(typeof csv.contentBytes).toBe('number');
    expect(csv.content).toContain('ts,level,message,meta');
    expect(csv.content).toContain('audit.warn');

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const logsOutOfRange = service.exportLogs('json', {
      dateFrom: tomorrow
    });
    expect(JSON.parse(logsOutOfRange.content)).toHaveLength(0);
  });

  it('filtra apenas eventos de update no export de logs', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: 1
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([
        {
          ts: '2026-02-22T10:00:00.000Z',
          level: 'info',
          message: 'update.check.finish',
          meta: { code: null }
        },
        {
          ts: '2026-02-22T10:01:00.000Z',
          level: 'warn',
          message: 'app.relaunch',
          meta: { reason: 'update-apply' }
        },
        {
          ts: '2026-02-22T10:02:00.000Z',
          level: 'info',
          message: 'mock.runtime.status'
        }
      ])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);
    const exported = service.exportLogs('json', {
      scope: 'updates'
    });
    const parsed = JSON.parse(exported.content) as Array<{ message: string }>;

    expect(parsed.map((item) => item.message)).toEqual(['update.check.finish', 'app.relaunch']);
  });

  it('retorna contagem de logs com estimativa de tamanho por formato', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: 1
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([
        {
          ts: '2026-02-22T10:00:00.000Z',
          level: 'info',
          message: 'update.check.finish',
          meta: { code: null }
        },
        {
          ts: '2026-02-22T10:01:00.000Z',
          level: 'info',
          message: 'mock.runtime.status'
        }
      ])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);
    const count = service.countLogs({
      scope: 'updates'
    });

    expect(count.scope).toBe('updates');
    expect(count.count).toBe(1);
    expect(count.estimatedBytesJson).toBeGreaterThan(0);
    expect(count.estimatedBytesCsv).toBeGreaterThan(0);
  });

  it('exporta trilha de auditoria de updates em schema dedicado (json/csv)', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: 1
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([
        {
          ts: '2026-02-22T10:00:00.000Z',
          level: 'info',
          message: 'update.check.finish',
          meta: { phase: 'available', code: null, stagedVersion: '0.1.4' }
        },
        {
          ts: '2026-02-22T10:01:00.000Z',
          level: 'warn',
          message: 'app.relaunch',
          meta: { reason: 'update-apply' }
        },
        {
          ts: '2026-02-22T10:02:00.000Z',
          level: 'info',
          message: 'mock.runtime.status'
        }
      ])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);
    const json = service.exportUpdateAuditTrail('json', {
      dateFrom: '2026-02-22T00:00:00.000Z',
      dateTo: '2026-02-22T23:59:59.999Z',
      severity: 'all',
      codeOnly: false
    });
    const parsed = JSON.parse(json.content) as {
      schema: string;
      filter: { family?: string; severity?: string; codeOnly?: boolean };
      count: number;
      integrity: { itemsSha256: string };
      items: Array<{ event: string; family: string; category: string; version: string | null }>;
    };

    expect(json.fileName).toContain('dexter-update-audit-');
    expect(parsed.schema).toBe('dexter.update-audit.v1');
    expect(parsed.filter.severity).toBe('all');
    expect(parsed.filter.codeOnly).toBe(false);
    expect(parsed.integrity.itemsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.count).toBe(2);
    expect(parsed.items.map((item) => item.event)).toEqual(['update.check.finish', 'app.relaunch']);
    expect(parsed.items.map((item) => item.family)).toEqual(['check', 'apply']);
    expect(parsed.items[0]?.version).toBe('0.1.4');
    expect(parsed.items[1]?.category).toBe('app');
    expect(typeof json.sha256).toBe('string');
    expect(typeof json.contentBytes).toBe('number');

    const csv = service.exportUpdateAuditTrail('csv');
    expect(csv.fileName.endsWith('.csv')).toBe(true);
    expect(csv.content).toContain('ts,level,event,family,category,code,phase,version,reason,meta');
    expect(csv.content).toContain('update.check.finish');
    expect(csv.content).toContain('app.relaunch');
    expect(csv.content).toContain('# schema=dexter.update-audit.v1');
    expect(csv.content).toContain('# items_sha256=');
    expect(csv.content).not.toContain('mock.runtime.status');

    const onlyApply = service.exportUpdateAuditTrail('json', {
      family: 'apply'
    });
    const onlyApplyParsed = JSON.parse(onlyApply.content) as { count: number; items: Array<{ family: string }> };
    expect(onlyApplyParsed.count).toBe(1);
    expect(onlyApplyParsed.items[0]?.family).toBe('apply');
  });

  it('conta trilha de auditoria de updates por familia com estimativa de bytes', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: 1
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([
        {
          ts: '2026-02-22T10:00:00.000Z',
          level: 'info',
          message: 'update.check.finish',
          meta: { phase: 'available' }
        },
        {
          ts: '2026-02-22T10:01:00.000Z',
          level: 'info',
          message: 'update.download.finish',
          meta: { version: '0.1.4' }
        },
        {
          ts: '2026-02-22T10:02:00.000Z',
          level: 'warn',
          message: 'app.relaunch',
          meta: { reason: 'update-apply' }
        }
      ])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);

    const checkCount = service.countUpdateAuditTrail({
      family: 'check'
    });
    expect(checkCount.family).toBe('check');
    expect(checkCount.severity).toBe('all');
    expect(checkCount.codeOnly).toBe(false);
    expect(checkCount.count).toBe(1);
    expect(checkCount.estimatedBytesJson).toBeGreaterThan(0);
    expect(checkCount.estimatedBytesCsv).toBeGreaterThan(0);

    const allCount = service.countUpdateAuditTrail();
    expect(allCount.family).toBe('all');
    expect(allCount.severity).toBe('all');
    expect(allCount.codeOnly).toBe(false);
    expect(allCount.count).toBe(3);

    const warnWithCodeOnly = service.countUpdateAuditTrail({
      severity: 'warn-error',
      codeOnly: true
    });
    expect(warnWithCodeOnly.severity).toBe('warn-error');
    expect(warnWithCodeOnly.codeOnly).toBe(true);
    expect(warnWithCodeOnly.count).toBe(0);
  });

  it('pagina historico em multiplas consultas e respeita limite superior de data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-audit-'));
    tempDirs.push(dir);

    const logger = new Logger(dir);
    const history = new ModelHistoryService(dir);
    const service = new AuditExportService(history, logger);

    for (let i = 0; i < 130; i += 1) {
      history.block('pull', `model-${i}`, `Bloqueado ${i}`);
    }

    const page = history.query({
      page: 1,
      pageSize: 1,
      operation: 'all',
      status: 'all'
    });
    const newest = page.items[0];
    if (!newest) {
      throw new Error('Esperava ao menos um registro');
    }

    const exported = service.exportModelHistory('json', {
      operation: 'all',
      status: 'all',
      dateTo: newest.startedAt
    });
    const parsed = JSON.parse(exported.content) as Array<{ id: string }>;
    expect(parsed.length).toBeGreaterThanOrEqual(100);
  });

  it('faz escape CSV e ignora timestamps invalidos ao exportar logs', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: 1
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([
        {
          ts: 'invalido',
          level: 'info',
          message: 'nao deve aparecer',
          meta: {
            bad: true
          }
        },
        {
          ts: '2026-02-22T10:00:00.000Z',
          level: 'warn',
          message: 'linha,com,virgula\nquebra "aspas"',
          meta: {
            texto: 'x,y'
          }
        }
      ])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);
    const logsCsv = service.exportLogs('csv', {
      dateFrom: '2026-02-22T00:00:00.000Z',
      dateTo: '2026-02-22T23:59:59.999Z'
    });

    expect(logsCsv.content).toContain('ts,level,message,meta');
    expect(logsCsv.content).toContain('"linha,com,virgula');
    expect(logsCsv.content).toContain('""aspas""');
    expect(logsCsv.content).not.toContain('nao deve aparecer');
  });

  it('evita loop longo quando totalPages inconsistente e itens vazios', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: Number.POSITIVE_INFINITY
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);
    const exported = service.exportModelHistory('json', {
      operation: 'all',
      status: 'all'
    });

    expect(JSON.parse(exported.content)).toEqual([]);
    expect(fakeHistory.query).toHaveBeenCalledTimes(1);
  });

  it('exporta CSV com campos nulos e respeita limite superior de data nos logs', () => {
    const startedAt = '2026-02-22T10:00:00.000Z';
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [
          {
            id: 'running-1',
            operation: 'pull',
            model: 'qwen2.5:7b',
            status: 'running',
            message: 'baixando',
            startedAt,
            finishedAt: null,
            durationMs: null,
            percent: null
          }
        ],
        totalPages: 1
      })
    };

    const fakeLogger = {
      entries: vi.fn().mockReturnValue([
        {
          ts: '2026-02-22T09:00:00.000Z',
          level: 'info',
          message: 'entrada antiga'
        },
        {
          ts: '2026-02-22T11:00:00.000Z',
          level: 'info',
          message: 'entrada nova'
        }
      ])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);

    const historyCsv = service.exportModelHistory('csv', {
      operation: 'all',
      status: 'all'
    });
    expect(historyCsv.content).toContain('running-1,pull,qwen2.5:7b,running,baixando,2026-02-22T10:00:00.000Z,,,');

    const logsCsv = service.exportLogs('csv', {
      dateTo: '2026-02-22T10:00:00.000Z'
    });
    expect(logsCsv.content).toContain('entrada antiga');
    expect(logsCsv.content).not.toContain('entrada nova');
    expect(logsCsv.content).toContain('ts,level,message,meta');
  });

  it('aplica defaults de filtro para operation/status quando nao informados', () => {
    const fakeHistory = {
      query: vi.fn().mockReturnValue({
        items: [],
        totalPages: 1
      })
    };
    const fakeLogger = {
      entries: vi.fn().mockReturnValue([])
    };

    const service = new AuditExportService(fakeHistory as never, fakeLogger as never);
    service.exportModelHistory('json');

    expect(fakeHistory.query).toHaveBeenCalledWith({
      page: 1,
      pageSize: 100,
      operation: 'all',
      status: 'all'
    });
  });
});
