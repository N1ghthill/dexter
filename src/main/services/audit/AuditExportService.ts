import { createHash } from 'node:crypto';
import type {
  ExportFormat,
  ExportPayload,
  LogExportCount,
  LogExportFilter,
  ModelHistoryFilter,
  ModelHistoryRecord,
  UpdateAuditTrailFamily,
  UpdateAuditTrailCount,
  UpdateAuditTrailFilter,
  UpdateAuditTrailJsonPayload,
  UpdateAuditTrailRecord,
  UpdateAuditTrailSeverity
} from '@shared/contracts';
import type { LogEntry } from '@main/services/logging/Logger';
import { Logger } from '@main/services/logging/Logger';
import { ModelHistoryService } from '@main/services/models/ModelHistoryService';

const HISTORY_EXPORT_PAGE_SIZE = 100;
const HISTORY_EXPORT_MAX_PAGES = 1000;

export class AuditExportService {
  constructor(
    private readonly modelHistoryService: ModelHistoryService,
    private readonly logger: Logger
  ) {}

  exportModelHistory(format: ExportFormat, filter: ModelHistoryFilter = {}): ExportPayload {
    const records = this.collectHistory(filter);
    const stamp = fileStamp();

    if (format === 'csv') {
      return finalizeExportPayload({
        fileName: `dexter-model-history-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: historyToCsv(records)
      });
    }

    return finalizeExportPayload({
      fileName: `dexter-model-history-${stamp}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(records, null, 2)
    });
  }

  exportLogs(format: ExportFormat, filter: LogExportFilter = {}): ExportPayload {
    const entries = this.collectLogs(filter);
    const stamp = fileStamp();

    if (format === 'csv') {
      return finalizeExportPayload({
        fileName: `dexter-logs-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: logsToCsv(entries)
      });
    }

    return finalizeExportPayload({
      fileName: `dexter-logs-${stamp}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(entries, null, 2)
    });
  }

  countLogs(filter: LogExportFilter = {}): LogExportCount {
    const entries = this.collectLogs(filter);
    const estimatedBytesJson = utf8ByteLength(JSON.stringify(entries, null, 2));
    const estimatedBytesCsv = utf8ByteLength(logsToCsv(entries));

    return {
      scope: filter.scope === 'updates' ? 'updates' : 'all',
      count: entries.length,
      estimatedBytesJson,
      estimatedBytesCsv
    };
  }

  exportUpdateAuditTrail(format: ExportFormat, filter: UpdateAuditTrailFilter = {}): ExportPayload {
    const { items, itemsSha256, normalizedFilter } = this.collectUpdateAuditTrailData(filter);
    const stamp = fileStamp();

    if (format === 'csv') {
      return finalizeExportPayload({
        fileName: `dexter-update-audit-${stamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: updateAuditTrailToCsv(items, itemsSha256)
      });
    }

    const payload: UpdateAuditTrailJsonPayload = {
      schema: 'dexter.update-audit.v1',
      generatedAt: new Date().toISOString(),
      filter: {
        dateFrom: normalizedFilter.dateFrom,
        dateTo: normalizedFilter.dateTo,
        family: normalizedFilter.family,
        severity: normalizedFilter.severity,
        codeOnly: normalizedFilter.codeOnly
      },
      count: items.length,
      integrity: {
        itemsSha256
      },
      items
    };

    return finalizeExportPayload({
      fileName: `dexter-update-audit-${stamp}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(payload, null, 2)
    });
  }

  countUpdateAuditTrail(filter: UpdateAuditTrailFilter = {}): UpdateAuditTrailCount {
    const { items, itemsSha256, normalizedFilter } = this.collectUpdateAuditTrailData(filter);
    const jsonPayload: UpdateAuditTrailJsonPayload = {
      schema: 'dexter.update-audit.v1',
      generatedAt: new Date().toISOString(),
      filter: {
        dateFrom: normalizedFilter.dateFrom,
        dateTo: normalizedFilter.dateTo,
        family: normalizedFilter.family,
        severity: normalizedFilter.severity,
        codeOnly: normalizedFilter.codeOnly
      },
      count: items.length,
      integrity: {
        itemsSha256
      },
      items
    };

    return {
      family: normalizedFilter.family,
      severity: normalizedFilter.severity,
      codeOnly: normalizedFilter.codeOnly,
      count: items.length,
      estimatedBytesJson: utf8ByteLength(JSON.stringify(jsonPayload, null, 2)),
      estimatedBytesCsv: utf8ByteLength(updateAuditTrailToCsv(items, itemsSha256))
    };
  }

  private collectHistory(filter: ModelHistoryFilter): ModelHistoryRecord[] {
    const operation = filter.operation ?? 'all';
    const status = filter.status ?? 'all';
    const pageSize = HISTORY_EXPORT_PAGE_SIZE;
    const records: ModelHistoryRecord[] = [];

    for (let page = 1; page <= HISTORY_EXPORT_MAX_PAGES; page += 1) {
      const result = this.modelHistoryService.query({
        page,
        pageSize,
        operation,
        status
      });

      records.push(...result.items);
      const totalPages = sanitizeTotalPages(result.totalPages);

      if (page >= totalPages || result.items.length === 0) {
        break;
      }
    }

    return records.filter((item) => isWithinDateRange(item.startedAt, filter.dateFrom, filter.dateTo));
  }

  private collectLogs(filter: LogExportFilter): LogEntry[] {
    return this.logger
      .entries()
      .filter((entry) => isWithinDateRange(entry.ts, filter.dateFrom, filter.dateTo))
      .filter((entry) => matchesLogExportScope(entry, filter.scope));
  }

  private collectUpdateAuditTrailData(filter: UpdateAuditTrailFilter): {
    items: UpdateAuditTrailRecord[];
    itemsSha256: string;
    normalizedFilter: UpdateAuditTrailFilter & {
      family: UpdateAuditTrailFamily;
      severity: UpdateAuditTrailSeverity;
      codeOnly: boolean;
    };
  } {
    const normalizedFilter = {
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      family: filter.family ?? 'all',
      severity: filter.severity ?? 'all',
      codeOnly: filter.codeOnly === true
    };
    const entries = this.collectLogs({
      ...normalizedFilter,
      scope: 'updates'
    });
    const items = entries
      .map(toUpdateAuditTrailRecord)
      .filter((item) => matchesUpdateAuditFamily(item, normalizedFilter.family))
      .filter((item) => matchesUpdateAuditSeverity(item, normalizedFilter.severity))
      .filter((item) => matchesUpdateAuditCodePresence(item, normalizedFilter.codeOnly));
    const itemsSha256 = sha256Hex(JSON.stringify(items));

    return {
      items,
      itemsSha256,
      normalizedFilter
    };
  }
}

function historyToCsv(items: ModelHistoryRecord[]): string {
  const header = [
    'id',
    'operation',
    'model',
    'status',
    'message',
    'startedAt',
    'finishedAt',
    'durationMs',
    'percent'
  ];
  const rows = items.map((item) => [
    item.id,
    item.operation,
    item.model,
    item.status,
    item.message,
    item.startedAt,
    item.finishedAt ?? '',
    item.durationMs === null ? '' : String(item.durationMs),
    item.percent === null ? '' : String(item.percent)
  ]);

  return toCsv([header, ...rows]);
}

function logsToCsv(items: LogEntry[]): string {
  const header = ['ts', 'level', 'message', 'meta'];
  const rows = items.map((entry) => [
    entry.ts,
    entry.level,
    entry.message,
    entry.meta === undefined ? '' : JSON.stringify(entry.meta)
  ]);

  return toCsv([header, ...rows]);
}

function updateAuditTrailToCsv(items: UpdateAuditTrailRecord[], itemsSha256: string): string {
  const header = ['ts', 'level', 'event', 'family', 'category', 'code', 'phase', 'version', 'reason', 'meta'];
  const rows = items.map((item) => [
    item.ts,
    item.level,
    item.event,
    item.family,
    item.category,
    item.code ?? '',
    item.phase ?? '',
    item.version ?? '',
    item.reason ?? '',
    item.meta === null ? '' : JSON.stringify(item.meta)
  ]);

  const csv = toCsv([header, ...rows]);
  return `${csv}\n# schema=dexter.update-audit.v1\n# count=${items.length}\n# items_sha256=${itemsSha256}`;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function csvEscape(value: string): string {
  if (/["\n,]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function fileStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

function finalizeExportPayload(payload: ExportPayload): ExportPayload {
  const contentBytes = utf8ByteLength(payload.content);
  const sha256 = sha256Hex(payload.content);

  return {
    ...payload,
    contentBytes,
    sha256
  };
}

function isWithinDateRange(timestamp: string, dateFrom?: string, dateTo?: string): boolean {
  const valueMs = parseMs(timestamp);
  if (valueMs === null) {
    return false;
  }

  const fromMs = parseMs(dateFrom);
  if (fromMs !== null && valueMs < fromMs) {
    return false;
  }

  const toMs = parseMs(dateTo);
  if (toMs !== null && valueMs > toMs) {
    return false;
  }

  return true;
}

function parseMs(value?: string): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function sanitizeTotalPages(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(HISTORY_EXPORT_MAX_PAGES, Math.trunc(value)));
}

function matchesLogExportScope(entry: LogEntry, scope: LogExportFilter['scope']): boolean {
  const normalizedScope = scope === 'updates' ? 'updates' : 'all';
  if (normalizedScope === 'all') {
    return true;
  }

  if (entry.message.startsWith('update.')) {
    return true;
  }

  if (entry.message === 'app.relaunch') {
    const meta = entry.meta as { reason?: unknown } | undefined;
    return meta?.reason === 'update-apply';
  }

  return false;
}

function toUpdateAuditTrailRecord(entry: LogEntry): UpdateAuditTrailRecord {
  const meta = asRecord(entry.meta);
  const version = readString(meta, 'version') ?? readString(meta, 'stagedVersion');
  const family = deriveUpdateAuditFamily(entry.message);

  return {
    ts: entry.ts,
    level: entry.level,
    event: entry.message,
    family,
    category: entry.message === 'app.relaunch' ? 'app' : 'update',
    code: readString(meta, 'code'),
    phase: readString(meta, 'phase'),
    version,
    reason: readString(meta, 'reason'),
    meta
  };
}

function deriveUpdateAuditFamily(event: string): UpdateAuditTrailFamily {
  if (event === 'app.relaunch' || event.startsWith('update.apply.')) {
    return 'apply';
  }
  if (event.startsWith('update.check.')) {
    return 'check';
  }
  if (event.startsWith('update.download.')) {
    return 'download';
  }
  if (event.startsWith('update.migration.')) {
    return 'migration';
  }
  if (event.startsWith('update.rollback.')) {
    return 'rollback';
  }
  if (event.startsWith('update.')) {
    return 'other';
  }

  return 'other';
}

function matchesUpdateAuditFamily(item: UpdateAuditTrailRecord, family: UpdateAuditTrailFilter['family']): boolean {
  const normalized = family ?? 'all';
  if (normalized === 'all') {
    return true;
  }

  return item.family === normalized;
}

function matchesUpdateAuditSeverity(
  item: UpdateAuditTrailRecord,
  severity: UpdateAuditTrailFilter['severity']
): boolean {
  const normalized = severity ?? 'all';
  if (normalized === 'all') {
    return true;
  }

  return item.level === 'warn' || item.level === 'error';
}

function matchesUpdateAuditCodePresence(item: UpdateAuditTrailRecord, codeOnly: UpdateAuditTrailFilter['codeOnly']): boolean {
  if (!codeOnly) {
    return true;
  }

  return typeof item.code === 'string' && item.code.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
