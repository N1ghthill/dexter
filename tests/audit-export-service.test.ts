import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed.some((entry) => entry.message === 'audit.test')).toBe(true);

    const csv = service.exportLogs('csv');
    expect(csv.fileName.endsWith('.csv')).toBe(true);
    expect(csv.content).toContain('ts,level,message,meta');
    expect(csv.content).toContain('audit.warn');

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const logsOutOfRange = service.exportLogs('json', {
      dateFrom: tomorrow
    });
    expect(JSON.parse(logsOutOfRange.content)).toHaveLength(0);
  });
});
